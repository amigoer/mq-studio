package kafka

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kmsg"

	"github.com/amigoer/mq-studio/internal/model"
)

// fakeCluster starts an in-process Kafka and returns its bootstrap list.
//
// It exists so the connection paths that matter - a cluster that answers, one
// that rejects a credential, one that is not there - are covered with nothing
// running. A real broker cannot be made to refuse a password on demand without
// a second container, and would not be available at all on a checkout with no
// docker.
func fakeCluster(t *testing.T, options ...kfake.Opt) string {
	t.Helper()
	cluster, err := kfake.NewCluster(options...)
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)
	return strings.Join(cluster.ListenAddrs(), ",")
}

func openProfile(t *testing.T, profile model.ConnectionProfile) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *kafka.Conn", opened)
	}
	return conn
}

func TestOpenAgainstAReachableCluster(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: fakeCluster(t),
	})

	if conn.Kind() != model.KindKafka {
		t.Errorf("kind = %q, want kafka", conn.Kind())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("Ping failed against a running cluster: %v", err)
	}
	for capability, reason := range conn.Capabilities().Degraded {
		t.Errorf("%s was degraded (%s) against a cluster that answers", capability, reason)
	}
}

// A cluster that is not there has to read as unreachable rather than as a
// rejected credential: the two send an operator to completely different
// places, and the address is the one they can fix.
func TestOpenAgainstNothingReportsUnreachable(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{
		Name:       "gone",
		Endpoints:  vacatedAddress(t),
		TimeoutSec: 1,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err == nil {
		t.Fatal("Ping succeeded against a cluster that is not running")
	} else if reason := degradeReason(err, false); reason != endpointUnreachable && reason != endpointTimedOut {
		t.Errorf("degrade reason = %q, want unreachable or timed out", reason)
	}
}

// vacatedAddress is an address nothing is listening on. It comes from a
// cluster that has been closed rather than from a guessed port number, so no
// other process can be holding it.
func vacatedAddress(t *testing.T) string {
	t.Helper()
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the throwaway cluster: %v", err)
	}
	address := strings.Join(cluster.ListenAddrs(), ",")
	cluster.Close()
	return address
}

func TestPingClassifiesABadCredential(t *testing.T) {
	address := fakeCluster(t,
		kfake.EnableSASL(),
		kfake.Superuser("SCRAM-SHA-512", "admin", "right-password"),
	)

	cases := []struct {
		name     string
		password string
		digest   string
		wantOK   bool
		want     string
	}{
		{name: "the right credential connects", password: "right-password", digest: "512", wantOK: true},
		{name: "a wrong password is a credential problem", password: "wrong-password", digest: "512", want: credentialsRejected},
		{name: "the wrong scram digest is a credential problem too", password: "right-password", digest: "256", want: credentialsRejected},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			conn := openProfile(t, model.ConnectionProfile{
				Name:      "sasl",
				Endpoints: address,
				Auth:      model.AuthConfig{Mechanism: model.AuthSASLScram},
				Options:   map[string]string{OptionSCRAMSHA: test.digest},
				Secrets: map[string]string{
					SecretUsername: "admin",
					SecretPassword: test.password,
				},
			})

			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			err := conn.Ping(ctx)
			if test.wantOK {
				if err != nil {
					t.Fatalf("Ping failed with the right credential: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("Ping succeeded with a credential the cluster should refuse")
			}
			if reason := degradeReason(err, true); reason != test.want {
				t.Errorf("degrade reason = %q, want %q (error was %v)", reason, test.want, err)
			}
		})
	}
}

// The service layer puts the request deadline on the context and every driver
// is expected to honour it. franz-go takes a context on every call, so this is
// asserting the driver did not lose it on the way through.
func TestPingHonoursAnExpiredContext(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{Name: "fake", Endpoints: fakeCluster(t)})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	err := conn.Ping(ctx)
	if err == nil {
		t.Fatal("Ping succeeded on a cancelled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("Ping took %v to notice a cancelled context", elapsed)
	}
}

// The registry closes a connection on disconnect and again on shutdown.
func TestCloseIsRepeatable(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{Name: "fake", Endpoints: fakeCluster(t)})

	for attempt := 1; attempt <= 3; attempt++ {
		if err := conn.Close(); err != nil {
			t.Fatalf("Close attempt %d failed: %v", attempt, err)
		}
	}
}

// Open reads the profile before it builds anything, so a profile that cannot
// produce a client has to fail here rather than yield a connection that fails
// on its first use.
func TestOpenRefusesAProfileItCannotDial(t *testing.T) {
	cases := []struct {
		name    string
		profile model.ConnectionProfile
	}{
		{"no bootstrap servers", model.ConnectionProfile{Name: "empty"}},
		{
			"an unusable scram digest",
			model.ConnectionProfile{
				Name:      "bad-digest",
				Endpoints: "localhost:9092",
				Auth:      model.AuthConfig{Mechanism: model.AuthSASLScram},
				Options:   map[string]string{OptionSCRAMSHA: "1"},
			},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			conn, err := New().Open(context.Background(), test.profile)
			if err == nil {
				_ = conn.Close()
				t.Fatal("Open succeeded on a profile it cannot dial")
			}
		})
	}
}

/*
 * A credential is not written until the cluster will admit it exists.
 *
 * Kafka stores a SCRAM credential in the metadata log and answers a describe
 * from whichever broker took the request, so "created" and "visible" are two
 * different instants. A create that returned at the first one left the access
 * page listing users without the one just added - which reads as a create that
 * silently failed. It showed up as a live test failing only under load, so it
 * is pinned here where the delay can be made to happen on purpose.
 */
func TestCreatingAUserWaitsUntilTheClusterListsIt(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	const quiet = 2
	describes := 0
	cluster.ControlKey(kmsg.DescribeUserSCRAMCredentials.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			describes++
			if describes > quiet {
				// Hand it back to the cluster, which now answers truthfully.
				return nil, nil, false
			}
			// The credential exists and this broker has not heard: a user with
			// no credentials, which is what a describe returns before the
			// record is applied.
			asked := request.(*kmsg.DescribeUserSCRAMCredentialsRequest)
			answer := asked.ResponseKind().(*kmsg.DescribeUserSCRAMCredentialsResponse)
			for _, user := range asked.Users {
				answer.Results = append(answer.Results,
					kmsg.DescribeUserSCRAMCredentialsResponseResult{User: user.Name})
			}
			return answer, nil, true
		})

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{
		Name: "alice", Secret: "a-password", Type: "SCRAM-SHA-512",
	}); err != nil {
		t.Fatalf("PutPrincipal: %v", err)
	}
	if describes <= quiet {
		t.Fatalf("the create returned after %d describe(s); it did not wait for the cluster", describes)
	}

	// And the thing the waiting is for: the page lists the user immediately
	// after the create, with no refresh and no retry of its own.
	principals, err := conn.ListPrincipals(ctx)
	if err != nil {
		t.Fatalf("ListPrincipals: %v", err)
	}
	for _, principal := range principals {
		if principal.Name == "alice" {
			return
		}
	}
	t.Fatalf("the user is not listed straight after being created: %v", principals)
}

// A user is listed before a new mechanism of theirs is. A user holds one
// credential per mechanism, so adding SCRAM-SHA-512 to one that has
// SCRAM-SHA-256 finds the user already there - and waiting for the user
// returned before the new mechanism was listed.
func TestAddingAMechanismWaitsForItNotJustTheUser(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{
		Name: "alice", Secret: "a-password", Type: "SCRAM-SHA-256",
	}); err != nil {
		t.Fatalf("PutPrincipal SCRAM-SHA-256: %v", err)
	}

	const stale = 2
	describes := 0
	cluster.ControlKey(kmsg.DescribeUserSCRAMCredentials.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			describes++
			if describes > stale {
				return nil, nil, false
			}
			// What the cluster said before the write: SCRAM-SHA-256 only.
			info := kmsg.NewDescribeUserSCRAMCredentialsResponseResultCredentialInfo()
			info.Mechanism = int8(kadm.ScramSha256)
			info.Iterations = scramIterations
			result := kmsg.NewDescribeUserSCRAMCredentialsResponseResult()
			result.User = "alice"
			result.CredentialInfos = append(result.CredentialInfos, info)
			answer := request.ResponseKind().(*kmsg.DescribeUserSCRAMCredentialsResponse)
			answer.Results = append(answer.Results, result)
			return answer, nil, true
		})

	if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{
		Name: "alice", Secret: "a-password", Type: "SCRAM-SHA-512",
	}); err != nil {
		t.Fatalf("PutPrincipal SCRAM-SHA-512: %v", err)
	}
	if describes <= stale {
		t.Fatalf("the write returned after %d describe(s) that did not list SCRAM-SHA-512", describes)
	}
	if describes > stale+1 {
		t.Fatalf("the write kept waiting through %d describe(s) that listed SCRAM-SHA-512", describes-stale)
	}

	principals, err := conn.ListPrincipals(ctx)
	if err != nil {
		t.Fatalf("ListPrincipals: %v", err)
	}
	for _, principal := range principals {
		if principal.Name == "alice" {
			if principal.Type != "SCRAM-SHA-256, SCRAM-SHA-512" {
				t.Fatalf("mechanisms = %q straight after adding one, want both", principal.Type)
			}
			return
		}
	}
	t.Fatalf("the user is not listed straight after the write: %v", principals)
}

// Deleting a user means deleting a password per mechanism, and Kafka refuses a
// request that alters one user twice - so sending both at once removed neither
// and a user with two mechanisms could not be deleted at all. The rule is the
// broker's, and the fake is what enforces it here: kfake takes the request.
func TestDeletingAUserSendsOneRequestPerMechanism(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	for _, mechanism := range []string{"SCRAM-SHA-256", "SCRAM-SHA-512"} {
		if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{
			Name: "alice", Secret: "a-password", Type: mechanism,
		}); err != nil {
			t.Fatalf("PutPrincipal %s: %v", mechanism, err)
		}
	}

	cluster.ControlKey(kmsg.AlterUserSCRAMCredentials.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			asked := request.(*kmsg.AlterUserSCRAMCredentialsRequest)
			altered := make(map[string]int)
			for _, deletion := range asked.Deletions {
				altered[deletion.Name]++
			}
			for _, upsertion := range asked.Upsertions {
				altered[upsertion.Name]++
			}
			for name, times := range altered {
				if times == 1 {
					continue
				}
				// Word for word what the broker answers, having applied nothing.
				answer := asked.ResponseKind().(*kmsg.AlterUserSCRAMCredentialsResponse)
				result := kmsg.NewAlterUserSCRAMCredentialsResponseResult()
				result.User = name
				result.ErrorCode = kerr.DuplicateResource.Code
				result.ErrorMessage = kmsg.StringPtr(
					"A user credential cannot be altered twice in the same request")
				answer.Results = append(answer.Results, result)
				return answer, nil, true
			}
			return nil, nil, false
		})

	if err := conn.RemovePrincipal(ctx, "alice"); err != nil {
		t.Fatalf("RemovePrincipal on a user with two mechanisms: %v", err)
	}

	principals, err := conn.ListPrincipals(ctx)
	if err != nil {
		t.Fatalf("ListPrincipals: %v", err)
	}
	for _, principal := range principals {
		if principal.Name == "alice" {
			t.Fatalf("the user is still listed, with %q", principal.Type)
		}
	}
}

// The same lag on the other half of the access page. An authorizer writes its
// rules to the metadata log too, and a describe answered before the record is
// applied showed the list without the rule just written.
func TestWritingARuleWaitsUntilTheClusterListsIt(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	const quiet = 2
	describes := 0
	cluster.ControlKey(kmsg.DescribeACLs.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			describes++
			if describes > quiet {
				return nil, nil, false
			}
			// No rules yet: what a broker that has not applied the record says.
			return request.ResponseKind().(*kmsg.DescribeACLsResponse), nil, true
		})

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const subject = "User:alice"
	if err := conn.PutAccessRule(ctx, model.AccessRule{
		Subject:  subject,
		Policies: []model.AccessPolicy{{Resource: "topic:orders", Actions: []string{"READ"}, Effect: "Allow"}},
	}); err != nil {
		t.Fatalf("PutAccessRule: %v", err)
	}
	if describes <= quiet {
		t.Fatalf("the write returned after %d describe(s); it did not wait for the cluster", describes)
	}

	rules, err := conn.ListAccessRules(ctx)
	if err != nil {
		t.Fatalf("ListAccessRules: %v", err)
	}
	for _, rule := range rules {
		if rule.Subject == subject {
			return
		}
	}
	t.Fatalf("the rule is not listed straight after being written: %v", rules)
}

// A subject is listed before its whole rule is. Each policy is a create of its
// own, so a describe can show the subject with its last policy still missing -
// and a subject that already had rules looks like that before the write
// starts. Waiting for the subject alone returned there, with the deny not yet
// listed.
func TestWritingARuleWaitsForEveryPolicyNotJustTheSubject(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Installed after Open, whose capability probe describes too, so every
	// describe counted here is the write's own.
	const subject = "User:alice"
	const partial = 2
	describes := 0
	cluster.ControlKey(kmsg.DescribeACLs.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			describes++
			if describes > partial {
				return nil, nil, false
			}
			// The allow applied and the deny not yet.
			response := request.ResponseKind().(*kmsg.DescribeACLsResponse)
			response.Resources = []kmsg.DescribeACLsResponseResource{{
				ResourceType:        kmsg.ACLResourceTypeTopic,
				ResourceName:        "orders",
				ResourcePatternType: kmsg.ACLResourcePatternTypeLiteral,
				ACLs: []kmsg.DescribeACLsResponseResourceACL{{
					Principal:      subject,
					Host:           "*",
					Operation:      kmsg.ACLOperationRead,
					PermissionType: kmsg.ACLPermissionTypeAllow,
				}},
			}}
			return response, nil, true
		})

	if err := conn.PutAccessRule(ctx, model.AccessRule{
		Subject: subject,
		Policies: []model.AccessPolicy{
			{Resource: "topic:orders", Actions: []string{"READ"}, Effect: "Allow"},
			{Resource: "topic:secrets", Actions: []string{"READ"}, Effect: "Deny",
				SourceIPs: []string{"10.0.0.1"}},
		},
	}); err != nil {
		t.Fatalf("PutAccessRule: %v", err)
	}
	if describes <= partial {
		t.Fatalf("the write returned after %d describe(s) that did not list the deny", describes)
	}
	if describes > partial+1 {
		t.Fatalf("the write kept waiting through %d describe(s) that listed the deny", describes-partial)
	}

	rules, err := conn.ListAccessRules(ctx)
	if err != nil {
		t.Fatalf("ListAccessRules: %v", err)
	}
	for _, rule := range rules {
		if rule.Subject != subject {
			continue
		}
		for _, policy := range rule.Policies {
			if policy.Resource == "topic:secrets" && policy.Effect == "Deny" {
				return
			}
		}
		t.Fatalf("the deny is not listed straight after being written: %v", rule.Policies)
	}
	t.Fatalf("the rule is not listed straight after being written: %v", rules)
}

/*
 * A send waits for a topic that is on its way.
 *
 * franz-go stops after four metadata queries that do not know the topic, and
 * with this driver's short refresh that is under half a second - so producing
 * to a topic created moments earlier failed with "this server does not host
 * this topic-partition", which reads as a wrong name rather than as a wait.
 * Kafka creates a topic on the controller and the brokers learn about it
 * afterwards, so there is always a gap; on a loaded cluster it outlasted the
 * default budget.
 *
 * The topic here appears while the produce is already trying, which is that
 * gap made deliberate rather than hoped for.
 */
func TestASendWaitsForATopicThatIsStillPropagating(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const topic = "orders.created"
	// Longer than the default budget of four queries, shorter than the one
	// this driver sets. A send that gives up early fails; one that waits does
	// not.
	const appearsAfter = 800 * time.Millisecond

	created := make(chan error, 1)
	go func() {
		time.Sleep(appearsAfter)
		created <- conn.CreateDestination(ctx, model.DestinationSpec{
			Ref: model.DestinationRef{Name: topic}, Partitions: 1,
			Attributes: map[string]string{AttrReplicationFactor: "1"},
		})
	}()

	result, err := conn.SendRecord(ctx, RecordRequest{
		Topic: topic, Value: "waiting", Count: 1,
	})
	if err := <-created; err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}
	if err != nil {
		t.Fatalf("the send gave up on a topic that arrived %s later: %v", appearsAfter, err)
	}
	if result.Sent != 1 || result.Failed != 0 {
		t.Errorf("sent %d, failed %d (%s); want one sent", result.Sent, result.Failed, result.Reason)
	}
}
