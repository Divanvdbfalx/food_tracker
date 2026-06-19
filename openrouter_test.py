
import os
import base64
import dotenv
from openai import OpenAI

dotenv.load_dotenv()

client = OpenAI(
  base_url="https://openrouter.ai/api/v1",
  api_key=os.getenv("OPENROUTER_API_KEY"))

with open("image.png", "rb") as f:
  image_data = base64.b64encode(f.read()).decode("utf-8")

completion = client.chat.completions.create(
  model="openrouter/free",
  messages=[
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": f"data:image/png;base64,{image_data}"
          }
        },
        {
          "type": "text",
          "text": "What is in this image? And estimate the macros. List only Short Description, Protein, Calories, Carbs, Fat"
        }
      ]
    }
  ]
)
print(completion.choices[0].message.content)
