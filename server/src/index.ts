import cors from "cors";
import express from "express";
import { imageRouter } from "./routes/images";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/cards/images", imageRouter);

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
