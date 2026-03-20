FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy

WORKDIR /app

# ffmpeg + Xvfb + Google Chrome 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    wget \
    gnupg \
    && wget -q -O /tmp/chrome.deb \
        https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
