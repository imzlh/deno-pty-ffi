# Deno Pty FFI

deno wrapper over https://docs.rs/portable-pty/latest/portable_pty/ that exposes
a simple interface
为Deno 扩充的PTY支持，使用RUST的 portable-pty，多线程防止阻塞。

## Usage

我修改的库只留下了2个方法2个Pipe管道

 - readable = STDOUT + STDERR
 - writable = STDIN
 - resize() 调整大小
 - getSize() 获取大小(主要是测试时用到)

当管道Write端关闭 (调用close) 时表示关闭PTY进程，将自动释放资源