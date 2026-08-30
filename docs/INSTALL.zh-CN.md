# 安装 MQ Studio

安装包统一命名为 `mq-studio-<版本>-<系统>-<架构>.<后缀>`，从
[Releases](https://github.com/amigoer/mq-studio/releases) 下载。

每个版本都附带 `SHA256SUMS.txt`，校验下载文件：

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

Windows 上用 `Get-FileHash <文件> -Algorithm SHA256` 后人工比对。

---

## macOS

需要 macOS 12 或更高版本。Apple 芯片选 `arm64`，Intel 芯片选 `amd64`——在
「关于本机」里可以看到自己是哪一种。

1. 打开 `.dmg`。
2. 把 **MQ Studio** 拖到同一个窗口里的 **Applications** 文件夹上。
3. 双击那个窗口里的 **首次运行 First Run**。
4. 推出磁盘映像。

### 第 3 步是干什么的

MQ Studio 目前还没有用 Apple Developer ID 签名。macOS 会给所有从浏览器下载的
文件打上隔离属性，而这个属性会在你把 App 从磁盘映像里拖出来时**一并复制过去**。
对于没有注册开发者签名的 App，Gatekeeper 不会给出「仍要打开」的选项，而是直接
提示 **「已损坏，无法打开」**，并且只给「移到废纸篓」这一个按钮。App 并没有损坏，
这只是 macOS 在无法识别签名者时使用的措辞。

「首次运行」这个脚本就是把隔离属性去掉，仅此而已。每次安装只需要执行一次。

**如果这个脚本本身也被拦住了**，对它点右键（或按住 Control 点按）选择
**打开**——脚本走的仍然是这条可以放行的路径。如果还是不行，打开「终端」粘贴：

```bash
xattr -dr com.apple.quarantine "/Applications/MQ Studio.app"
```

这条命令在任何 macOS 版本上都有效，脚本做的也正是这件事。

等 App 完成签名和公证之后，本节内容会整体移除。

### 本地网络权限

MQ Studio 第一次连接局域网里的 broker 时，macOS 会申请「本地网络」权限，
**请允许**——一旦拒绝，连接不会报权限错误，而是直接超时，很难排查。

macOS 是按代码签名来记住这个授权的。当前构建使用的是临时签名（ad-hoc），
每次构建签名都会变，所以每次更新后可能会被重新询问一次。

---

## Windows

需要 Windows 10（Server 2016）或更高版本。运行
`mq-studio-<版本>-windows-<架构>.exe`。

安装器目前还没有代码签名，所以 SmartScreen 会提示「Windows 已保护你的电脑」。
点击 **更多信息** → **仍要运行**。

安装器会装到 `Program Files`，创建开始菜单和桌面快捷方式，在缺少 WebView2
运行时的机器上自动安装它，并在「应用和功能」里注册卸载项。

---

## Linux

需要 GTK 4 和 WebKitGTK 6.0 —— 即 Ubuntu 24.04 及以上、Debian 13 及以上，以及其他发行版的
同期版本。更早的发行版自带的是 WebKit2GTK 4.1，无法运行这些包。对应的软件包在 Debian 与
Ubuntu 上是 `libgtk-4-1` 和 `libwebkitgtk-6.0-4`，在 Fedora 与 RHEL 上是 `gtk4` 和
`webkitgtk6.0`。

**Debian、Ubuntu：**

```bash
sudo apt install ./mq-studio-<版本>-linux-<架构>.deb
```

**Fedora、RHEL、AlmaLinux、Rocky：**

```bash
sudo dnf install ./mq-studio-<版本>-linux-<架构>.rpm
```

两者都会把 MQ Studio 加进应用菜单。

**AppImage** —— 各发行版通用，但不会自动添加菜单项：

```bash
chmod +x mq-studio-<版本>-linux-<架构>.AppImage
./mq-studio-<版本>-linux-<架构>.AppImage
```

---

## 数据存放位置

连接配置和设置保存在本地用户配置目录中，凭据加密存储。但**配置导出文件里的
凭据是明文的**，请妥善保管。
