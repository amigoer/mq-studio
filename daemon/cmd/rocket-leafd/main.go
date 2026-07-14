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
	"strings"
	"syscall"
	"time"

	"rocket-leaf/internal/app"
	transport "rocket-leaf/internal/transport/http"
)

const protocolVersion = 1

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
	handler := transport.NewHandler(services, config.Token, func() {
		select {
		case shutdownRequested <- struct{}{}:
		default:
		}
	})
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	port := listener.Addr().(*net.TCPAddr).Port
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
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	select {
	case <-parentGone:
	case <-signals:
	case <-shutdownRequested:
	case err := <-serveErr:
		return fmt.Errorf("HTTP 服务异常退出: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return server.Shutdown(ctx)
}
