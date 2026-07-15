// Package api 提供仅供 Electron 主进程访问的私有回环 HTTP API。
package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
	"strconv"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/app"
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

// Electron 允许导入 5 MiB 配置；再包进 {"content":"..."} 时引号和反斜杠
// 会被转义，最坏接近两倍，因此为私有 API 预留 12 MiB 上限。
const maxRequestBody = 12 << 20

type handler struct {
	services *app.Services
	token    string
	shutdown func()
}

type apiError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"requestId"`
	Details   map[string]any `json:"details,omitempty"`
}

type connectionView struct {
	ID                  int                    `json:"id"`
	Name                string                 `json:"name"`
	Env                 model.ConnectionEnv    `json:"env"`
	NameServer          string                 `json:"nameServer"`
	TimeoutSec          int                    `json:"timeoutSec"`
	EnableACL           bool                   `json:"enableACL"`
	AccessKey           string                 `json:"accessKey"`
	SecretKey           string                 `json:"secretKey"`
	AccessKeyConfigured bool                   `json:"accessKeyConfigured"`
	SecretKeyConfigured bool                   `json:"secretKeyConfigured"`
	Status              model.ConnectionStatus `json:"status"`
	LastCheck           string                 `json:"lastCheck"`
	IsDefault           bool                   `json:"isDefault"`
	Remark              string                 `json:"remark"`
}

type settingsView struct {
	model.AppSettings
	GlobalAccessKeyConfigured bool `json:"globalAccessKeyConfigured"`
	GlobalSecretKeyConfigured bool `json:"globalSecretKeyConfigured"`
}

type connectionRequest struct {
	Name        string `json:"name"`
	Env         string `json:"env"`
	NameServer  string `json:"nameServer"`
	TimeoutSec  int    `json:"timeoutSec"`
	EnableACL   bool   `json:"enableACL"`
	AccessKey   string `json:"accessKey"`
	SecretKey   string `json:"secretKey"`
	Remark      string `json:"remark"`
	Credentials string `json:"credentialsMode"`
}

type settingsUpdateRequest struct {
	model.AppSettings
	GlobalCredentialsMode string `json:"globalCredentialsMode"`
}

// NewHandler 构造带鉴权和故障隔离的私有 API。
func NewHandler(services *app.Services, token string, shutdown func()) stdhttp.Handler {
	h := &handler{services: services, token: token, shutdown: shutdown}
	mux := stdhttp.NewServeMux()
	mux.HandleFunc("GET /v1/health", h.health)
	mux.HandleFunc("POST /v1/shutdown", h.requestShutdown)

	mux.HandleFunc("GET /v1/connections", h.getConnections)
	mux.HandleFunc("POST /v1/connections", h.addConnection)
	mux.HandleFunc("PUT /v1/connections/{id}", h.updateConnection)
	mux.HandleFunc("DELETE /v1/connections/{id}", h.deleteConnection)
	mux.HandleFunc("POST /v1/connections/{id}/connect", h.connect)
	mux.HandleFunc("POST /v1/connections/{id}/disconnect", h.disconnect)
	mux.HandleFunc("POST /v1/connections/{id}/default", h.setDefaultConnection)
	mux.HandleFunc("POST /v1/connections/{id}/test", h.testConnection)
	mux.HandleFunc("POST /v1/connections/connect-default", h.connectDefault)

	mux.HandleFunc("GET /v1/settings", h.getSettings)
	mux.HandleFunc("PUT /v1/settings", h.updateSettings)
	mux.HandleFunc("POST /v1/settings/reset", h.resetSettings)
	mux.HandleFunc("POST /v1/settings/clear-cache", h.clearCache)
	mux.HandleFunc("GET /v1/settings/export", h.exportConfig)
	mux.HandleFunc("POST /v1/settings/import", h.importConfig)

	mux.HandleFunc("GET /v1/cluster", h.getClusterInfo)
	mux.HandleFunc("GET /v1/cluster/summary", h.getClusterSummary)
	mux.HandleFunc("GET /v1/cluster/brokers", h.getBrokers)
	mux.HandleFunc("GET /v1/cluster/brokers/detail", h.getBrokerDetail)

	mux.HandleFunc("GET /v1/topics", h.getTopics)
	mux.HandleFunc("POST /v1/topics", h.createTopic)
	mux.HandleFunc("GET /v1/topics/detail", h.getTopicDetail)
	mux.HandleFunc("GET /v1/topics/stats", h.getTopicStats)
	mux.HandleFunc("PUT /v1/topics", h.updateTopic)
	mux.HandleFunc("DELETE /v1/topics", h.deleteTopic)

	mux.HandleFunc("GET /v1/consumers", h.getConsumers)
	mux.HandleFunc("POST /v1/consumers", h.createConsumer)
	mux.HandleFunc("GET /v1/consumers/detail", h.getConsumerDetail)
	mux.HandleFunc("GET /v1/consumers/stats", h.getConsumeStats)
	mux.HandleFunc("PUT /v1/consumers", h.updateConsumer)
	mux.HandleFunc("DELETE /v1/consumers", h.deleteConsumer)
	mux.HandleFunc("POST /v1/consumers/reset-offset", h.resetOffset)

	mux.HandleFunc("GET /v1/messages", h.queryMessages)
	mux.HandleFunc("GET /v1/messages/by-id", h.queryMessageByID)
	mux.HandleFunc("GET /v1/messages/track", h.getMessageTrack)
	mux.HandleFunc("GET /v1/messages/dlq", h.queryDLQMessages)
	mux.HandleFunc("GET /v1/messages/retry", h.queryRetryMessages)
	mux.HandleFunc("POST /v1/messages/resend", h.resendMessage)
	mux.HandleFunc("POST /v1/messages/send", h.sendMessage)

	mux.HandleFunc("GET /v1/acl/enabled", h.getACLEnabled)
	mux.HandleFunc("GET /v1/acl/version", h.getACLVersion)
	mux.HandleFunc("PUT /v1/acl/access-config", h.updateAccessConfig)
	mux.HandleFunc("DELETE /v1/acl/access-config", h.deleteAccessConfig)
	mux.HandleFunc("PUT /v1/acl/global-white-addrs", h.updateGlobalWhiteAddrs)

	return h.recoverPanic(h.authenticate(mux))
}

func (h *handler) authenticate(next stdhttp.Handler) stdhttp.Handler {
	expected := []byte("Bearer " + h.token)
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		provided := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(provided, expected) != 1 {
			writeError(w, r, stdhttp.StatusUnauthorized, "UNAUTHORIZED", "未授权访问", nil)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (h *handler) recoverPanic(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		defer func() {
			if recover() != nil {
				writeError(w, r, stdhttp.StatusInternalServerError, "INTERNAL_ERROR", "服务内部错误", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requestID(r *stdhttp.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Request-ID")); value != "" && len(value) <= 128 {
		return value
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(random)
}

func writeJSON(w stdhttp.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func writeError(w stdhttp.ResponseWriter, r *stdhttp.Request, status int, code, message string, details map[string]any) {
	writeJSON(w, status, apiError{Code: code, Message: message, RequestID: requestID(r), Details: details})
}

func serviceError(w stdhttp.ResponseWriter, r *stdhttp.Request, err error) {
	writeError(w, r, stdhttp.StatusBadRequest, "OPERATION_FAILED", err.Error(), nil)
}

func decodeJSON(w stdhttp.ResponseWriter, r *stdhttp.Request, value any) bool {
	r.Body = stdhttp.MaxBytesReader(w, r.Body, maxRequestBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "请求参数格式错误", nil)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "请求只能包含一个 JSON 对象", nil)
		return false
	}
	return true
}

func intPath(w stdhttp.ResponseWriter, r *stdhttp.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "连接 ID 无效", nil)
		return 0, false
	}
	return id, true
}

func queryInt(r *stdhttp.Request, name string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return fallback
	}
	return value
}

func queryInt64(r *stdhttp.Request, name string) int64 {
	value, _ := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	return value
}

func redactConnection(conn *model.Connection) *connectionView {
	if conn == nil {
		return nil
	}
	return &connectionView{
		ID: conn.ID, Name: conn.Name, Env: conn.Env, NameServer: conn.NameServer,
		TimeoutSec: conn.TimeoutSec, EnableACL: conn.EnableACL,
		AccessKeyConfigured: strings.TrimSpace(conn.AccessKey) != "",
		SecretKeyConfigured: strings.TrimSpace(conn.SecretKey) != "",
		Status:              conn.Status, LastCheck: conn.LastCheck, IsDefault: conn.IsDefault, Remark: conn.Remark,
	}
}

func redactConnections(connections []*model.Connection) []*connectionView {
	result := make([]*connectionView, 0, len(connections))
	for _, connection := range connections {
		if view := redactConnection(connection); view != nil {
			result = append(result, view)
		}
	}
	return result
}

func redactSettings(settings *model.AppSettings) *settingsView {
	if settings == nil {
		return nil
	}
	view := *settings
	accessConfigured := strings.TrimSpace(view.GlobalAccessKey) != ""
	secretConfigured := strings.TrimSpace(view.GlobalSecretKey) != ""
	view.GlobalAccessKey = ""
	view.GlobalSecretKey = ""
	return &settingsView{AppSettings: view, GlobalAccessKeyConfigured: accessConfigured, GlobalSecretKeyConfigured: secretConfigured}
}

func (h *handler) health(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, map[string]any{"status": "ok", "protocolVersion": 1})
}

func (h *handler) requestShutdown(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusAccepted, map[string]bool{"accepted": true})
	go h.shutdown()
}

func (h *handler) getConnections(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, redactConnections(h.services.Connections.GetConnections()))
}

func (h *handler) addConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input connectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	connection, err := h.services.Connections.AddConnection(input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, input.AccessKey, input.SecretKey, input.Remark)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusCreated, redactConnection(connection))
}

func (h *handler) updateConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	var input connectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	current, err := h.services.Connections.GetConnection(id)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	accessKey, secretKey := input.AccessKey, input.SecretKey
	switch input.Credentials {
	case "preserve", "":
		if input.EnableACL && accessKey == "" && secretKey == "" {
			accessKey, secretKey = current.AccessKey, current.SecretKey
		}
	case "clear":
		input.EnableACL, accessKey, secretKey = false, "", ""
	case "replace":
	default:
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "凭证更新模式无效", nil)
		return
	}
	connection, err := h.services.Connections.UpdateConnection(id, input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, accessKey, secretKey, input.Remark)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactConnection(connection))
}

func (h *handler) deleteConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	if err := h.services.Connections.DeleteConnection(id); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) connectionAction(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(int) error) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	if err := action(id); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) connect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.services.Connections.Connect)
}
func (h *handler) disconnect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.services.Connections.Disconnect)
}
func (h *handler) setDefaultConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.services.Connections.SetDefaultConnection)
}
func (h *handler) connectDefault(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Connections.ConnectDefault(); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
func (h *handler) testConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	status, err := h.services.Connections.TestConnection(id)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"status": status})
}

func (h *handler) getSettings(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, redactSettings(h.services.Settings.GetSettings()))
}

func (h *handler) updateSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input settingsUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	current := h.services.Settings.GetSettings()
	switch input.GlobalCredentialsMode {
	case "preserve", "":
		if input.GlobalAccessKey == "" && input.GlobalSecretKey == "" {
			input.GlobalAccessKey = current.GlobalAccessKey
			input.GlobalSecretKey = current.GlobalSecretKey
		}
	case "clear":
		input.GlobalAccessKey, input.GlobalSecretKey = "", ""
	case "replace":
		if strings.TrimSpace(input.GlobalAccessKey) == "" || strings.TrimSpace(input.GlobalSecretKey) == "" {
			writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "AccessKey 和 SecretKey 必须同时填写", nil)
			return
		}
	default:
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "全局凭证更新模式无效", nil)
		return
	}
	settings, err := h.services.Settings.UpdateSettings(input.AppSettings)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactSettings(settings))
}

func (h *handler) resetSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	settings, err := h.services.Settings.ResetSettings()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactSettings(settings))
}

func (h *handler) clearCache(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Settings.ClearCache(); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) exportConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	content, err := h.services.Settings.ExportAllConfig()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"content": content})
}

func (h *handler) importConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		Content string `json:"content"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.Settings.ImportAllConfig(input.Content); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) getClusterInfo(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetClusterInfo()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getClusterSummary(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetClusterSummary()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getBrokers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetBrokers()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getBrokerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetBrokerDetail(r.URL.Query().Get("brokerAddr"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

type topicRequest struct {
	Topic      string `json:"topic"`
	BrokerAddr string `json:"brokerAddr"`
	ReadQueue  int    `json:"readQueue"`
	WriteQueue int    `json:"writeQueue"`
	Perm       string `json:"perm"`
}

func (h *handler) getTopics(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var result []*model.TopicItem
	var err error
	if r.URL.Query().Get("scope") == "all" {
		result, err = h.services.Topics.GetAllTopics()
	} else {
		result, err = h.services.Topics.GetTopics()
	}
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getTopicDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Topics.GetTopicDetail(r.URL.Query().Get("topic"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getTopicStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Topics.GetTopicStats(r.URL.Query().Get("topic"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) createTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.topicMutation(w, r, h.services.Topics.CreateTopic)
}
func (h *handler) updateTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.topicMutation(w, r, h.services.Topics.UpdateTopic)
}
func (h *handler) topicMutation(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, int, int, string) error) {
	var input topicRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := action(input.Topic, input.BrokerAddr, input.ReadQueue, input.WriteQueue, input.Perm); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
func (h *handler) deleteTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Topics.DeleteTopic(r.URL.Query().Get("topic"), r.URL.Query().Get("clusterName")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

type consumerRequest struct {
	Group       string `json:"group"`
	BrokerAddr  string `json:"brokerAddr"`
	ConsumeMode string `json:"consumeMode"`
	MaxRetry    int    `json:"maxRetry"`
}

func (h *handler) getConsumers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Consumers.GetConsumerGroups()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getConsumerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Consumers.GetConsumerGroupDetail(r.URL.Query().Get("group"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getConsumeStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Consumers.GetConsumeStats(r.URL.Query().Get("group"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) createConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.consumerMutation(w, r, h.services.Consumers.CreateConsumerGroup)
}
func (h *handler) updateConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.consumerMutation(w, r, h.services.Consumers.UpdateConsumerGroup)
}
func (h *handler) consumerMutation(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, string, int) error) {
	var input consumerRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := action(input.Group, input.BrokerAddr, input.ConsumeMode, input.MaxRetry); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
func (h *handler) deleteConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Consumers.DeleteConsumerGroup(r.URL.Query().Get("group"), r.URL.Query().Get("brokerAddr")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
func (h *handler) resetOffset(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input model.ResetOffsetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.Consumers.ResetOffset(input.Group, input.Topic, input.Timestamp, input.Force); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) queryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryMessages(r.URL.Query().Get("topic"), r.URL.Query().Get("key"), r.URL.Query().Get("tag"), queryInt(r, "maxResults", 32), queryInt64(r, "startTime"), queryInt64(r, "endTime"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) queryMessageByID(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryMessageByID(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) getMessageTrack(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.GetMessageTrack(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) queryDLQMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryDLQMessages(r.URL.Query().Get("group"), queryInt(r, "maxResults", 32))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) queryRetryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryRetryMessages(r.URL.Query().Get("group"), queryInt(r, "maxResults", 32))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) resendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		ConsumerGroup string `json:"consumerGroup"`
		ClientID      string `json:"clientId"`
		Topic         string `json:"topic"`
		MessageID     string `json:"messageId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.services.Messages.ResendMessage(input.ConsumerGroup, input.ClientID, input.Topic, input.MessageID)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}
func (h *handler) sendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		Topic      string `json:"topic"`
		Tags       string `json:"tags"`
		Keys       string `json:"keys"`
		Body       string `json:"body"`
		DelayLevel int    `json:"delayLevel"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.services.Messages.SendMessage(input.Topic, input.Tags, input.Keys, input.Body, input.DelayLevel)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}

func (h *handler) getACLEnabled(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.ACL.GetAclEnabled()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]bool{"enabled": result})
}
func (h *handler) getACLVersion(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.ACL.GetAclVersion()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
func (h *handler) updateAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		AccessKey          string   `json:"accessKey"`
		SecretKey          string   `json:"secretKey"`
		WhiteRemoteAddress string   `json:"whiteRemoteAddress"`
		IsAdmin            bool     `json:"isAdmin"`
		DefaultTopicPerm   string   `json:"defaultTopicPerm"`
		DefaultGroupPerm   string   `json:"defaultGroupPerm"`
		TopicPerms         []string `json:"topicPerms"`
		GroupPerms         []string `json:"groupPerms"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.ACL.CreateOrUpdateAccessConfig(input.AccessKey, input.SecretKey, input.WhiteRemoteAddress, input.IsAdmin, input.DefaultTopicPerm, input.DefaultGroupPerm, input.TopicPerms, input.GroupPerms); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
func (h *handler) deleteAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.ACL.DeleteAccessConfig(r.URL.Query().Get("accessKey")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
func (h *handler) updateGlobalWhiteAddrs(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		Addrs []string `json:"addrs"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.ACL.UpdateGlobalWhiteAddrs(input.Addrs); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
