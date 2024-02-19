import { Pty } from "./mod.ts";

const socket = Deno.listen({
    port: 6666,
    hostname: 'localhost'
});

while (true) {
    const client = await socket.accept();
    if (!client) continue;
    const args = Deno.build.os == 'windows' ? ["\\k","chcp 65001"] : [],
        pty = new Pty({
            command: Deno.build.os == 'windows' ? 'cmd' : 'sh',
            args,
            env: {
                "TERM": "xterm"
            },
        });

    pty.readable.pipeTo(client.writable).catch(() => console.log('PTY Closed.'));
    client.readable.pipeTo(pty.writable).catch(() => console.log('Client Closed.'));
    
    setTimeout(() => client.close(),10000);
    setTimeout(() => console.log('Status:',pty.status),12000);
}