package rocketmq

import (
	"errors"
	"fmt"
	"testing"
)

func TestIsRetryableNetworkError(t *testing.T) {
	if IsRetryableNetworkError(nil) {
		t.Fatal("nil errors must not be retried")
	}
	if !IsRetryableNetworkError(errors.New("connection reset by peer")) {
		t.Fatal("connection resets must be retried")
	}
	if !IsRetryableNetworkError(fmt.Errorf("所有 nameserver 请求失败: timeout")) {
		t.Fatal("NameServer failures must be retried")
	}
	if IsRetryableNetworkError(errors.New("topic not exist")) {
		t.Fatal("business errors must not be retried")
	}
}
