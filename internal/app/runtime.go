package app

import (
	"time"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

// rocketMQRuntime binds connection lifecycle to the RocketMQ client manager.
//
// It lives in the composition root because it is the only place allowed to
// know both halves: the connection service defines what a client registry has
// to do, the driver knows how to do it, and neither imports the other.
type rocketMQRuntime struct {
	manager *rocketmq.AdminClientManager
}

func newRocketMQRuntime() connection.ClientRuntime {
	return &rocketMQRuntime{manager: rocketmq.GetClientManager()}
}

func (r *rocketMQRuntime) Connect(endpoint string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error {
	_, err := r.manager.CreateClient(endpoint, timeout, enableACL, accessKey, secretKey)
	return err
}

func (r *rocketMQRuntime) HasClient(endpoint string) bool {
	_, err := r.manager.GetClient(endpoint)
	return err == nil
}

func (r *rocketMQRuntime) SetDefault(endpoint string) error {
	return r.manager.SetDefaultConnection(endpoint)
}

func (r *rocketMQRuntime) Remove(endpoint string) {
	r.manager.RemoveClient(endpoint)
}

func (r *rocketMQRuntime) Test(endpoint string, timeout time.Duration, enableACL bool, accessKey, secretKey string) error {
	return r.manager.TestConnection(endpoint, timeout, enableACL, accessKey, secretKey)
}

func (r *rocketMQRuntime) CloseAll() {
	r.manager.CloseAll()
}
