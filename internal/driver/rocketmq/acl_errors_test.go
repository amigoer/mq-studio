package rocketmq

import (
	"errors"
	"fmt"
	"testing"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/amigoer/rocketmq-admin-go/protocol/remoting"
)

func TestIsRequestCodeNotSupported(t *testing.T) {
	if isRequestCodeNotSupported(nil) {
		t.Fatal("nil must not be treated as unsupported")
	}
	if isRequestCodeNotSupported(errors.New("plain")) {
		t.Fatal("an unrelated error must not be treated as unsupported")
	}
	adminError := &admin.AdminError{Code: remoting.RequestCodeNotSupported, Message: "unsupported"}
	if !isRequestCodeNotSupported(adminError) {
		t.Fatal("request-code-not-supported must be detected")
	}
	if !isRequestCodeNotSupported(fmt.Errorf("wrapped: %w", adminError)) {
		t.Fatal("wrapped request-code-not-supported must be detected")
	}
}
