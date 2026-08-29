import { createServer } from "./server.js";

const port = Number(process.env.PORT || 3000);
const app = createServer({} as any); // Pass empty queue for now

app.listen(port, () => {});
