package service

import (
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func TestGetConnectionsReturnsCopies(t *testing.T) {
	s := &ConnectionService{connections: map[int]*model.Connection{
		1: {ID: 1, Name: "original"},
	}}
	list := s.GetConnections()
	list[0].Name = "mutated"
	if s.connections[1].Name != "original" {
		t.Fatal("调用方不应能在锁外修改内部连接状态")
	}
}
