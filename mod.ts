import { dlopen } from "https://deno.land/x/plug/mod.ts";

/**
 * 初始化的参数
 */
export interface Command {
    /** 执行的命令 */
    command: string;
    /** 传递的参数 */
    args: string[];
    /** 赋予的环境变量 */
    env: Record<string, string>;
}

/**
 * 调整大小的参数
 */
export interface PtySize {
    /** 行数 */
    rows: number;
    /** 每行的字符数 */
    cols: number;
    /** 单个字符长度，在一些系统不一定生效 */
    pixel_width: number;
    /** 单个字符宽度，在一些系统不一定生效 */
    pixel_height: number;
}

const SYMBOLS = {
    pty_create: {
        parameters: ["buffer", "buffer"],
        result: "i8",
    },
    pty_read: {
        parameters: ["pointer", "buffer"],
        result: "i8",
        nonblocking: true,
    },
    pty_write: {
        parameters: ["pointer", "buffer", "buffer"],
        result: "i8",
        nonblocking: true,
    },
    pty_get_size: {
        parameters: ["pointer", "buffer"],
        result: "i8",
    },
    pty_resize: {
        parameters: ["pointer", "buffer", "buffer"],
        result: "i8",
    },
    pty_close: {
        parameters: ["pointer"],
        result: "void",
    },
    tmp_dir: {
        parameters: ["buffer"],
        result: "i8",
    },
} as const;

// 获取最新版本(使用GithubAPI)
let url: string;
const result = await (await fetch('https://api.github.com/repos/sigmaSd/deno-pty-ffi/releases/latest')).json();
if (result["tag_name"]) url = "https://github.com/sigmaSd/deno-pty-ffi/releases/download/" + result["tag_name"];
else {
    console.debug(result['message'] || result);
    console.error(
        'Failed to get the current PtyLib version.Please ensure the network connection.'
    );
    // fallback
    url = "https://github.com/sigmaSd/deno-pty-ffi/releases/download/0.19.6/";
}

// 初始化FFI库
const LIBRARY = await dlopen(
    {
        name: "pty",
        url: Deno.env.get("RUST_LIB_PATH") || url,
        // reload cache if developping locally
        cache: Deno.env.get("RUST_LIB_PATH") ? "reloadAll" : "use",
        suffixes: {
            linux: {
                x86_64: ""
            },
            darwin: {
                aarch64: "_aarch64",
                x86_64: "_x86_64",
            },
        },
    },
    SYMBOLS,
);

const encoder = new TextEncoder(),
    getPointer = (buffer:ArrayBuffer) => Deno.UnsafePointer.create(
            new BigInt64Array(buffer)[0]
        )!,
    wrap = new TextEncoder().encode('\r\n\0');

/**
 * 操作Pty的类
 */
export class Pty extends TransformStream<Uint8Array>{
    #this;
    #running;

    static BUFFER = 8;
    static SLEEP = 50;

    /**
     * Creates a new Pty instance with the specified command.
     * 可以使用readable、writable操作Pty流，且使用 `UInt8Array` 方便传输
     * @param command - The command to be executed in the pty.
     */
    constructor(command: Command) {
        // Result Buffer(1 char)
        const pty_buf = new Uint8Array(Pty.BUFFER),
            data = JSON.stringify({
                cmd: command.command,
                args: command.args,
                env: [...(function* () {
                    for (const key in command.env)
                        if (Object.prototype.hasOwnProperty.call(command.env, key))
                            yield [key, command.env[key]];
                })()]
            }) + '\0',
            result = LIBRARY.symbols.pty_create(
                new TextEncoder().encode(data + '\0'),
                pty_buf,
            ),
            ptr = getPointer(pty_buf.buffer);
        let timer:undefined | number;
        if (result === -1)
            throw new Error(new Deno.UnsafePointerView(ptr).getCString());

        super({
            start: ctrl => {
                timer = setInterval( async () =>{
                    const dataBuf = new Uint8Array(Pty.BUFFER);
                    const result = await LIBRARY.symbols.pty_read(ptr, dataBuf),
                        view = new Deno.UnsafePointerView(getPointer(dataBuf.buffer)),
                        str = view.getCString();
                    if (result === 99) return ctrl.terminate();
                    else if (result == -1) return ctrl.error(str);
                    else if(str.length > 0) ctrl.enqueue(encoder.encode(str+ '\0'));
                }, Pty.SLEEP);
            },
            transform: async (data, ctrl) => {

                // 兼容性设置：使用\r\n代替回车
                if(data[0] == wrap[0] || data[0] == wrap[1])
                    data = wrap;

                if(!(data instanceof Uint8Array))
                    throw new TypeError('Write failed: Not a vaild UInt8Array.');

                if(data.length == 0)
                    return;

                const dataBuf = new Uint8Array(8);
                const result = await LIBRARY.symbols.pty_write(
                    ptr,
                    data,
                    dataBuf,
                );
                const dataPtr = Deno.UnsafePointer.create(
                    new BigUint64Array(dataBuf.buffer)[0],
                )!;
                if (result === -1) ctrl.error(new Deno.UnsafePointerView(dataPtr).getCString());
            },
            cancel: async () => {
                clearInterval(timer);
                await LIBRARY.symbols.pty_close(this.#this);
                this.#running = false;
            }
        });

        this.#this = ptr,this.#running = true;
    }

    /**
     * Resizes the pty to the specified size.
     * @param size - The new size for the pty.
     */
    set size(size: PtySize) {
        if(!this.#running) throw new TypeError('Failed: Process dead.');
        const errBuf = new Uint8Array(8);
        const result = LIBRARY.symbols.pty_resize(
            this.#this,
            encoder.encode(JSON.stringify(size) + '\0'),
            errBuf,
        );
        if (result === -1) throw new Error(new Deno.UnsafePointerView(
            getPointer(errBuf.buffer)
        ).getCString());
    }

    /**
     * Gets the size of the pty.
     * @returns The size of the pty.
     */
    get size(): PtySize {
        if(!this.#running) throw new TypeError('Failed: Process dead.');
        const dataBuf = new Uint8Array(8),
            result = LIBRARY.symbols.pty_get_size(this.#this, dataBuf),
            data = new Deno.UnsafePointerView(getPointer(dataBuf)).getCString();
        if (result === -1) throw new Error(data);
        return JSON.parse(data);
    }

    get status(){
        return this.#running ? 'running' : 'stopped';
    }
}
