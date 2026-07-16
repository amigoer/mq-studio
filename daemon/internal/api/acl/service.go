package acl

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the ACL operations required by the HTTP transport.
type Service interface {
	GetAclEnabled() (bool, error)
	GetAclVersion() (*model.AclVersionInfo, error)
	CreateOrUpdateAccessConfig(string, string, string, bool, string, string, []string, []string) error
	DeleteAccessConfig(string) error
	UpdateGlobalWhiteAddrs([]string) error
}
