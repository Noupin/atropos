FROM python:3.11-slim

WORKDIR /app

# Install cron and timezone data
RUN apt-get update && apt-get install -y --no-install-recommends \
    cron tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Set timezone for cron
ENV TZ=America/New_York
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

COPY . .

# Cron setup
COPY docker/cron /etc/cron.d/uploader
RUN chmod 0644 /etc/cron.d/uploader && crontab /etc/cron.d/uploader
RUN touch /var/log/cron.log

CMD ["cron", "-f"]
