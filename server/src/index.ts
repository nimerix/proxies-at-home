import cors from "cors";
import express from "express";
import { imageRouter } from "./routes/imageRouter";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/cards/images", imageRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on :${PORT}`);
});
