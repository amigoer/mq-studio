package kafka

import (
	"testing"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"

	"github.com/amigoer/mq-studio/internal/model"
)

func listedTxn(id, state string) kadm.ListedTransaction {
	return kadm.ListedTransaction{TxnID: id, State: state, Coordinator: 2, ProducerID: 1001}
}

func TestTransactionFromListAndDescribe(t *testing.T) {
	transaction := transactionFrom(
		listedTxn("orders-writer", txnOngoing),
		kadm.DescribedTransaction{
			TxnID: "orders-writer", State: txnOngoing, Coordinator: 2,
			ProducerID: 1001, ProducerEpoch: 7,
			TimeoutMillis: 60_000, StartTimestamp: 1_756_000_000_000,
			Topics: kadm.TopicsSet{"orders": {0: struct{}{}, 1: struct{}{}}},
		},
	)

	if transaction.ID != "orders-writer" || transaction.State != txnOngoing {
		t.Errorf("transaction = %+v", transaction)
	}
	if transaction.ProducerEpoch != 7 || transaction.TimeoutMs != 60_000 {
		t.Errorf("producer detail = %+v", transaction)
	}
	if transaction.StartedAt != 1_756_000_000_000 {
		t.Errorf("startedAt = %d", transaction.StartedAt)
	}
	if !transaction.Holding {
		t.Error("an ongoing transaction holding two partitions is not flagged")
	}
	// The partitions are what the transaction is holding up, sorted so the
	// panel does not reshuffle between refreshes.
	if len(transaction.Partitions) != 2 {
		t.Fatalf("partitions = %v", transaction.Partitions)
	}
	if transaction.Partitions[0] != "orders:0" || transaction.Partitions[1] != "orders:1" {
		t.Errorf("partitions = %v, want them ordered", transaction.Partitions)
	}
}

/*
 * A describe that failed costs the detail, not the row.
 *
 * Knowing a transaction exists is most of the value, and a coordinator that
 * will not describe one is exactly the situation where an operator most wants
 * to see that it is there.
 */
func TestATransactionSurvivesADescribeThatFailed(t *testing.T) {
	transaction := transactionFrom(
		listedTxn("orders-writer", txnOngoing),
		kadm.DescribedTransaction{Err: kerr.CoordinatorNotAvailable},
	)

	if transaction.ID != "orders-writer" {
		t.Errorf("the row was lost with the describe: %+v", transaction)
	}
	if transaction.State != txnOngoing {
		t.Errorf("state = %q, want the one the listing gave", transaction.State)
	}
	// Unknown, not 1970: a zero timestamp would render as a date.
	if transaction.StartedAt != model.UnknownMetric {
		t.Errorf("startedAt = %d, want unknown", transaction.StartedAt)
	}
	if len(transaction.Partitions) != 0 {
		t.Errorf("partitions = %v, want none", transaction.Partitions)
	}
	// Ongoing, but nothing known to be held: the row is worth showing and the
	// warning is not, because a describe that failed is not evidence.
	if transaction.Holding {
		t.Error("a transaction with no known partitions is flagged as holding")
	}
}

// A transaction can move between the list and the describe, and the describe
// is the later view.
func TestTheDescribeStateWins(t *testing.T) {
	transaction := transactionFrom(
		listedTxn("orders-writer", txnOngoing),
		kadm.DescribedTransaction{TxnID: "orders-writer", State: "CompleteCommit"},
	)
	if transaction.State != "CompleteCommit" {
		t.Errorf("state = %q, want the describe's", transaction.State)
	}
}

/*
 * Which transactions are actually holding a consumer back.
 *
 * Ongoing is the obvious one. The two prepare states count as well: the
 * coordinator has decided and is still writing markers, and a partition
 * without one is as unreadable as it was before. A completed or empty
 * transaction holds nothing, however recently it ran.
 */
func TestWhichTransactionsAreHoldingReadersBack(t *testing.T) {
	holding := func(state string, partitions ...string) bool {
		return TransactionIsHolding(&model.Transaction{State: state, Partitions: partitions})
	}

	if !holding(txnOngoing, "orders:0") {
		t.Error("an ongoing transaction with partitions is not reported as holding")
	}
	if !holding(txnPrepareCommit, "orders:0") {
		t.Error("a transaction mid-commit is not reported as holding")
	}
	if !holding(txnPrepareAbort, "orders:0") {
		t.Error("a transaction mid-abort is not reported as holding")
	}

	if holding("CompleteCommit", "orders:0") {
		t.Error("a finished transaction is reported as holding")
	}
	if holding("Empty") {
		t.Error("an empty transaction is reported as holding")
	}
	// Ongoing with nothing written yet holds nobody.
	if holding(txnOngoing) {
		t.Error("an ongoing transaction with no partitions is reported as holding")
	}
}
