# Backend с ROS 2 Jazzy: rclpy нужен адаптерам наблюдений и управления.
FROM ros:jazzy-ros-base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip python3-pytest \
    && pip install --no-cache-dir --break-system-packages "fastapi>=0.115" "uvicorn>=0.30" "httpx>=0.27" \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src ./src
COPY tests ./tests
COPY pyproject.toml ./
ENV PYTHONPATH=/app/src PYTHONUNBUFFERED=1 ROS_DOMAIN_ID=7
EXPOSE 8000
CMD ["bash", "-c", "source /opt/ros/jazzy/setup.bash && exec uvicorn --factory adapters.http.entrypoint:create_default_app --host 0.0.0.0 --port 8000"]
