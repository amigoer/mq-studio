package mcpserver

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
)

// offer presents a tool to a client, or reports that the allowance does not
// reach it. The two about the installation reach no broker and are always
// offered: a caller that cannot list the connections cannot use any of the
// rest.
func offer(tool toolset.Tool, allow catalog.Blast) (*mcp.Tool, bool) {
	if tool.Operation != "" && !catalog.Permits(allow, tool.Blast) {
		return nil, false
	}
	return &mcp.Tool{
		Name:         tool.Name,
		Description:  tool.Description,
		Annotations:  annotate(tool.Title, tool.Blast),
		InputSchema:  tool.InputSchema,
		OutputSchema: tool.OutputSchema,
	}, true
}

// offeredTools is the tool each catalogue operation an allowance reaches is
// performed by.
func offeredTools(allow catalog.Blast) map[string]string {
	offered := make(map[string]string)
	for _, tool := range toolset.All() {
		if tool.Operation == "" {
			continue
		}
		if _, ok := offer(tool, allow); ok {
			offered[tool.Operation] = tool.Name
		}
	}
	return offered
}

func (s *server) register(server *mcp.Server) {
	for _, tool := range toolset.All() {
		provide(s, server, tool)
	}
}
