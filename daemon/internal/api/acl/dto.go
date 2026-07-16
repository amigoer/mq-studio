package acl

type updateAccessConfigRequest struct {
	AccessKey          string   `json:"accessKey"`
	SecretKey          string   `json:"secretKey"`
	WhiteRemoteAddress string   `json:"whiteRemoteAddress"`
	IsAdmin            bool     `json:"isAdmin"`
	DefaultTopicPerm   string   `json:"defaultTopicPerm"`
	DefaultGroupPerm   string   `json:"defaultGroupPerm"`
	TopicPerms         []string `json:"topicPerms"`
	GroupPerms         []string `json:"groupPerms"`
}

type updateGlobalWhiteAddrsRequest struct {
	Addrs []string `json:"addrs"`
}
