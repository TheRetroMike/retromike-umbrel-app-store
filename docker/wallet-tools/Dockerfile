# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app/ /app/
EXPOSE 8080
CMD ["gunicorn","-b","0.0.0.0:8080","app:app"]
