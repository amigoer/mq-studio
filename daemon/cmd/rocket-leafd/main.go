package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/api"
	"github.com/amigoer/rocket-leaf/daemon/internal/app"
)

const protocolVersion = 1

// appVersion is injected at build time via -ldflags "-X main.appVersion=...".
// Default matches desktop/package.json for local go run / smoke tests.
var appVersion = "2.0.0"

type startupConfig struct {
	Token string `json:"token"`
}

type readyMessage struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Port            int    `json:"port"`
	PID             int    `json:"pid"`
	AppVersion      string `json:"appVersion"`
}

func main() {
	if err := run(); err != nil {
		log.Printf("[rocket-leafd] %v", err)
		os.Exit(1)
	}
}

func run() error {
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return fmt.Errorf("读取启动配置失败: %w", err)
	}
	var config startupConfig
	if err := json.Unmarshal(line, &config); err != nil {
		return fmt.Errorf("解析启动配置失败: %w", err)
	}
	if len(strings.TrimSpace(config.Token)) < 32 {
		return errors.New("启动令牌不符合安全要求")
	}

	services, err := app.New()
	if err != nil {
		return err
	}
	defer services.Close()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("监听回环端口失败: %w", err)
	}
	defer listener.Close()

	shutdownRequested := make(chan struct{}, 1)
	handler := api.NewHandler(services, config.Token, func() {
		select {
		case shutdownRequested <- struct{}{}:
		default:
		}
	})
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		// 聚合接口可能顺序执行多次受 requestTimeoutMs 约束的 RocketMQ 调用。
		WriteTimeout:   5 * time.Minute,
		IdleTimeout:    30 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	serveErr := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	port := listener.Addr().(*net.TCPAddr).Port
	// stdout is the startup protocol channel: only one JSON ready line, ever.
	if err := json.NewEncoder(os.Stdout).Encode(readyMessage{
		ProtocolVersion: protocolVersion,
		Port:            port,
		PID:             os.Getpid(),
		AppVersion:      appVersion,
	}); err != nil {
		return fmt.Errorf("输出就绪消息失败: %w", err)
	}

	parentGone := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, reader)
		close(parentGone)
	}()

	parentDead := watchParentProcess()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	select {
	case <-parentGone:
	case <-parentDead:
	case <-signals:
	case <-shutdownRequested:
	case err := <-serveErr:
		return fmt.Errorf("HTTP 服务异常退出: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return server.Shutdown(ctx)
}

// watchParentProcess exits the wait when the Electron parent disappears.
// Primary signal is stdin EOF (parentGone); this is a backup using ROCKET_LEAF_PARENT_PID.
func watchParentProcess() <-chan struct{} {
	done := make(chan struct{})
	raw := strings.TrimSpace(os.Getenv("ROCKET_LEAF_PARENT_PID"))
	if raw == "" {
		return done
	}
	pid, err := strconv.Atoi(raw)
	if err != nil || pid <= 0 {
		return done
	}
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if !processAlive(pid) {
				close(done)
				return
			}
		}
	}()
	return done
}
