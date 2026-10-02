package mcpserver

import (
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// The audit log itself is internal/agent/audit, shared with the window's
// assistant; what is here is how this server names its own records.

// auditPath is where the audit log lives: in the directory the window keeps
// its own files in, which is where somebody looking for it would look.
func auditPath(services *app.Services) string {
	if services == nil || services.Settings == nil {
		return ""
	}
	return layout.In(services.Settings.DataDirectory()).AgentAuditFile
}

// entry starts the records for one call to a write tool.
func (s *server) entry(
	request *mcp.CallToolRequest, tool string, operation catalog.Operation, id int, input any, call int64,
) audit.Record {
	allow, _ := s.ceiling(id)
	return audit.Record{
		Session:    s.session,
		Call:       call,
		Client:     clientOf(request),
		Tool:       tool,
		Operation:  operation.ID,
		Blast:      string(operation.Blast),
		Connection: s.auditConnection(id),
		Allow:      string(allow),
		Arguments:  toolset.Arguments(input),
	}
}

// clientOf names the agent client as it introduced itself.
func clientOf(request *mcp.CallToolRequest) string {
	if request == nil || request.Session == nil {
		return ""
	}
	params := request.Session.InitializeParams()
	if params == nil || params.ClientInfo == nil {
		return ""
	}
	return strings.TrimSpace(params.ClientInfo.Name + " " + params.ClientInfo.Version)
}

func (s *server) auditConnection(id int) audit.Connection {
	connection := audit.Connection{ID: id}
	if s.services.Connections == nil {
		return connection
	}
	if profile, err := s.services.Connections.GetConnection(id); err == nil {
		connection.Name, connection.Family = profile.Name, string(profile.Kind)
	}
	return connection
}
