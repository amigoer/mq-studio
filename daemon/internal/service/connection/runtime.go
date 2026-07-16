package connection

import (
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
)

// clientRuntime isolates the mutable RocketMQ client registry from profile
// persistence so lifecycle transactions can be tested deterministically.
type clientRuntime interface {
	Connect(nameServer string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error
	HasClient(nameServer string) bool
	SetDefault(nameServer string) error
	Remove(nameServer string)
	Test(nameServer string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error
	CloseAll()
}

type adminClientRuntime struct {
	manager *rocketmq.AdminClientManager
}

func newAdminClientRuntime() clientRuntime {
	return &adminClientRuntime{manager: rocketmq.GetClientManager()}
}

func (r *adminClientRuntime) Connect(nameServer string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error {
	_, err := r.manager.CreateClient(nameServer, timeout, enableACL, accessKey, secretKey)
	return err
}

func (r *adminClientRuntime) HasClient(nameServer string) bool {
	_, err := r.manager.GetClient(nameServer)
	return err == nil
}

func (r *adminClientRuntime) SetDefault(nameServer string) error {
	return r.manager.SetDefaultConnection(nameServer)
}

func (r *adminClientRuntime) Remove(nameServer string) {
	r.manager.RemoveClient(nameServer)
}

func (r *adminClientRuntime) Test(nameServer string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error {
	return r.manager.TestConnection(nameServer, timeout, enableACL, accessKey, secretKey)
}

func (r *adminClientRuntime) CloseAll() {
	r.manager.CloseAll()
}
