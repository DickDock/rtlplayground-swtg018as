# 自动化

[English](automation.en.md) | 简体中文

## 上传

可以通过 Web 使用 curl 实现固件上传的自动化：

1. 使用 /login 端点进行授权并保存 cookie：

   ```bash
   curl -c cookies.txt  http://${SWITCH_IP}/login -d pwd=${PASSWORD} -i
   ```

   这条命令会把 session cookie 保存到 cookies.txt 中
2. 通过表单发送固件：

    ```bash
    curl -b cookies.txt http://${SWITCH_IP}/upload -F "uploadedfile=@${FIRMWARE_FILE_PATH}" -i
    ```

    可以预期服务器会直接关闭连接而不响应请求。
    等待 SWITCH_IP 重新恢复响应即可。

## 端口状态

与上传类似，可以获取端口的 JSON 状态。

1. 按与上传相同的方式获取 session cookie。
2. 携带 cookie 访问 `/status.json`：

    ```bash
    curl -b cookies.txt http://${SWITCH_IP}/status.json
    ```
