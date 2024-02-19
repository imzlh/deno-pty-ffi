import { assert } from "https://deno.land/std@0.203.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.203.0/assert/assert_equals.ts";
import { Pty } from "../mod.ts";

Deno.test("smoke", async () => {
  const pty = new Pty({
    command: "deno",
    args: ["repl"],
    env: {"NO_COLOR": "1"},
  }),
  reader = pty.readable.getReader(),
  writer = pty.writable.getWriter();

  // read header
  await reader.read();

  await write_and_expect([writer,reader], "5+4\n\r", "9");
  await write_and_expect([writer,reader], "let a = 4; a + a\n\r", "8");

  // test size, resize
  assertEquals(pty.getSize(), {
    rows: 24,
    cols: 80,
    pixel_height: 0,
    pixel_width: 0,
  });

  // close the first pty
  // we should still create other ptys
  writer.close();
  const pty2 = new Pty({
    command: "deno",
    args: ["repl"],
    env: {"NO_COLOR": "1"},
  }),
  reader2 = pty.readable.getReader(),
  writer2 = pty.writable.getWriter();;
  // read header
  await reader2.read();

  await write_and_expect([writer2,reader2], "5+4\n\r", "9");
  writer2.close();
});

Deno.test("getSize/resize", () => {
  const pty = new Pty({
    command: "deno",
    args: ["repl"],
    env: {
      "NO_COLOR": "1"
    },
  });

  pty.resize({
    rows: 50,
    cols: 120,
    pixel_height: 1,
    pixel_width: 1,
  });
  assertEquals(pty.getSize(), {
    rows: 50,
    cols: 120,
    pixel_height: 1,
    pixel_width: 1,
  });
});

async function write_and_expect(stream: [WritableStreamDefaultWriter,ReadableStreamDefaultReader], toWrite: string, expect: string) {
  await stream[0].write(toWrite);

  let timeoutId;
  const success = await Promise.any([
    // FIXME: in case of timout, this promise reamins alive and it keeps the test form exiting
    (async () => {
      while (1) {
        const { value: r, done } = await stream[1].read();
        if (done) break;
        if (r && r.includes(expect)) {
          return true;
        }
      }
    })(),
    (async () => {
      await new Promise((r) => {
        timeoutId = setTimeout(r, 5000);
      });
      return false;
    })(),
  ]);

  clearTimeout(timeoutId);

  assert(success);
}
