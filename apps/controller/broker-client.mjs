import net from "node:net";

export function brokerCall(name, args, signal) {
  return new Promise((resolve, reject) => {
    let data = "";
    const socket = net.createConnection(process.env.ADP_BROKER_SOCKET);
    const abort = () => socket.destroy(new Error("Cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(80000, () => socket.destroy(new Error("Broker timeout")));
    socket.on("connect", () =>
      socket.write(JSON.stringify({ name, args }) + "\n"),
    );
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2000000)
        return socket.destroy(new Error("Broker response too large"));
      if (data.includes("\n")) {
        try {
          const response = JSON.parse(data.slice(0, data.indexOf("\n")));
          if (response.error) reject(new Error(response.error));
          else resolve(response.result);
        } catch (error) {
          reject(error);
        }
        socket.end();
      }
    });
    socket.on("error", reject);
    socket.on("end", () => {
      if (!data.includes("\n")) reject(new Error("Broker disconnected"));
    });
    socket.on("close", () => signal?.removeEventListener("abort", abort));
  });
}
