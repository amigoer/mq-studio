package message

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the message operations required by the HTTP transport.
type Service interface {
	QueryMessages(string, string, string, int, int64, int64) ([]*model.MessageItem, error)
	QueryMessageByID(string, string) (*model.MessageItem, error)
	GetMessageTrack(string, string) ([]*model.MessageTrackItem, error)
	QueryDLQMessages(string, int) ([]*model.MessageItem, error)
	QueryRetryMessages(string, int) ([]*model.MessageItem, error)
	ResendMessage(string, string, string, string) (string, error)
	SendMessage(string, string, string, string, int) (string, error)
}
