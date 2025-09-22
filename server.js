import express from "express";
import cors from "cors";
import pg from "pg";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Define Headers for OpenRouter ---
const openRouterHeaders = {
    "HTTP-Referer": `https://brahmin-circle-chatbot.onrender.com/`,
    "X-Title": `Brahmin Circle Chatbot`,
};

// Neon / Postgres connection
const client = new pg.Client({
    connectionString: process.env.NEON_DB_URL,
});
await client.connect();
console.log("Connected to Neon DB ✅");

// Helper: Get embeddings from OpenRouter
async function getEmbedding(text) {
    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/embeddings",
            {
                model: process.env.EMBEDDING_MODEL,
                input: text,
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    ...openRouterHeaders,
                },
            }
        );

        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0].embedding;
        } else {
            console.error("Unexpected response structure from OpenRouter:", response.data);
            throw new Error("Failed to get embedding from OpenRouter.");
        }
    } catch (error) {
        console.error("Error calling OpenRouter API for embeddings:");
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        throw error;
    }
}


// Helper: Search Neon for top 3 similar documents
async function searchNeon(query) {
    const embedding = await getEmbedding(query);

    const res = await client.query(
        `SELECT content FROM documents ORDER BY embedding <-> $1 LIMIT 3`,
        [embedding]
    );

    return res.rows.map((r) => r.content);
}

// Chat endpoint for Botpress
app.post("/chat", async (req, res) => {
    try {
        const { message } = req.body;
        const docs = await searchNeon(message);

        // Call OpenRouter for completion
        const completion = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: process.env.LLM_MODEL,
                messages: [
                    { role: "system", content: "You are a helpful assistant. Answer only using the context below." },
                    { role: "system", content: `Context:\n${docs.join("\n")}` },
                    { role: "user", content: message },
                ],
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    ...openRouterHeaders,
                },
            }
        );

        const reply = completion.data.choices[0].message.content;
        res.json({ reply });
    } catch (err) {
        res.status(500).json({ error: "Something went wrong" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`RAG backend running on port ${PORT} 🚀`));