package rocketmq

import (
	"errors"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/amigoer/rocketmq-admin-go/protocol/remoting"
)

// isRequestCodeNotSupported reports whether a broker rejected an unsupported admin RPC.
func isRequestCodeNotSupported(err error) bool {
	if err == nil {
		return false
	}
	var adminError *admin.AdminError
	return errors.As(err, &adminError) && adminError.Code == remoting.RequestCodeNotSupported
}
