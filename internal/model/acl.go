package model

// AclUser ACL 用户信息
type AclUser struct {
	Username   string   `json:"username"`   // 用户名
	Password   string   `json:"password"`   // 密码
	UserType   string   `json:"userType"`   // 用户类型
	UserStatus string   `json:"userStatus"` // 用户状态
	Permissions []string `json:"permissions"` // 权限列表
}

// AclRule ACL 规则
type AclRule struct {
	Subject     string      `json:"subject"`     // 主体（用户或组）
	Policies    []AclPolicy `json:"policies"`    // 策略列表
	Description string      `json:"description"` // 描述
}

// AclPolicy ACL 策略
type AclPolicy struct {
	Resource  string   `json:"resource"`  // 资源（Topic、Group）
	Actions   []string `json:"actions"`   // 操作（PUB、SUB）
	Effect    string   `json:"effect"`    // 效果（ALLOW、DENY）
	SourceIPs []string `json:"sourceIps"` // 来源 IP 限制
	Decision  string   `json:"decision"`  // 决策
}
