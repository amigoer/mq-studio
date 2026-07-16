package message

type resendMessageRequest struct {
	ConsumerGroup string `json:"consumerGroup"`
	ClientID      string `json:"clientId"`
	Topic         string `json:"topic"`
	MessageID     string `json:"messageId"`
}

type sendMessageRequest struct {
	Topic      string `json:"topic"`
	Tags       string `json:"tags"`
	Keys       string `json:"keys"`
	Body       string `json:"body"`
	DelayLevel int    `json:"delayLevel"`
}
