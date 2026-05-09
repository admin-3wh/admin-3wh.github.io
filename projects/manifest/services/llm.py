# services/llm.py

import os
import subprocess
from dotenv import load_dotenv

load_dotenv()


class LLMService:
    def __init__(self, mode: str = "local", local_model: str = "mistral"):
        self.mode = mode.lower()
        self.local_model = local_model

    def generate(self, prompt: str) -> str:
        if self.mode == "openai":
            return self._generate_openai(prompt)

        if self.mode == "local":
            return self._generate_local(prompt)

        raise ValueError(f"Unsupported LLM mode: {self.mode}")

    def _generate_openai(self, prompt: str) -> str:
        api_key = os.getenv("OPENAI_API_KEY")

        if not api_key:
            return (
                "OpenAI mode selected, but OPENAI_API_KEY is missing. "
                "Use local mode or add API billing/key later."
            )

        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)

            response = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are Manifest, a biomedical research synthesis engine. "
                            "Produce careful, evidence-grounded research briefs. "
                            "Do not invent claims. Use only the provided source chunks."
                        ),
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
                temperature=0.2,
            )

            return response.choices[0].message.content

        except Exception as e:
            return f"OpenAI generation failed: {e}"

    def _generate_local(self, prompt: str) -> str:
        """
        Local mode uses Ollama if installed.

        Example setup later:
            curl -fsSL https://ollama.com/install.sh | sh
            ollama pull mistral
        """

        try:
            result = subprocess.run(
                ["ollama", "run", self.local_model],
                input=prompt,
                text=True,
                capture_output=True,
                timeout=180,
            )

            if result.returncode != 0:
                return (
                    "Local LLM generation failed.\n\n"
                    f"stderr:\n{result.stderr}\n\n"
                    "You may need to install Ollama or pull a model."
                )

            return result.stdout.strip()

        except FileNotFoundError:
            return (
                "Local LLM mode selected, but Ollama is not installed.\n\n"
                "Install later with:\n"
                "curl -fsSL https://ollama.com/install.sh | sh\n\n"
                "Then pull a model:\n"
                "ollama pull mistral"
            )

        except subprocess.TimeoutExpired:
            return "Local LLM generation timed out."
