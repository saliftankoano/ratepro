import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
const systemPrompt =
  "You are an intelligent assistant designed to help students find the best professors based on their specific queries. When a student asks about a professor for a particular subject, teaching style, or other criteria, you will retrieve and present the top 3 professor recommendations. Each recommendation should include the professor's name, the subject they teach, their average star rating, and a brief summary of student reviews.Your response should be concise, informative, and tailored to the student's needs. If the student specifies a particular subject, focus on professors who teach that subject. If the student requests a teaching style, such as 'engaging' or 'challenging,' prioritize professors whose reviews align with those preferences.Ensure that the recommendations are relevant and helpful, guiding the student to make an informed decision. If the query is unclear, ask for clarification to provide the best possible recommendations.";
export async function POST(req) {
  const data = await req.json();
  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
  const index = pc.Index("rag").namespace("ns1");
  const openai = new OpenAI();
  const text = data[data.length - 1].content;
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    enconding_format: "float",
  });
  const results = await index.query({
    topK: 3,
    includeMetadata: true,
    vector: embedding.data[0].embedding,
  });
  let resultString = "Returned results from vectore DB (done automatically):";
  results.matches.forEach((match) => {
    resultString += `
        Professor: ${match.id},
        Review: ${match.metadata.review},
        Subject: ${match.metadata.subject},
        Stars: ${match.metadata.stars},
        \n\n
    `;
  });
  const lastMessage = data[data.length - 1];
  const lastMessageContent = lastMessage.content + resultString;
  const lastDataWithoutLastMessage = data.slice(0, data.length - 1);
  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      ...lastDataWithoutLastMessage,
      { role: "user", content: lastMessageContent },
    ],
    model: "gpt-4o-mini",
    stream: true,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunck of completion) {
          const content = chunck.choices[0]?.delta.content;
          if (content) {
            const text = encoder.encode(content);
            controller.enqueue(text);
          }
        }
      } catch (error) {
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });
  return new NextResponse(stream);
}
