#!/bin/bash
# Показ Gazebo: виртуальный дисплей + noVNC (http://localhost:6080/vnc.html), программный рендеринг.
source /opt/ros/jazzy/setup.bash
export DISPLAY=:1 LIBGL_ALWAYS_SOFTWARE=1 QT_QPA_PLATFORM=xcb
Xvfb :1 -screen 0 1280x800x24 &
sleep 2
openbox &
x11vnc -display :1 -forever -shared -nopw -quiet &
websockify --web /usr/share/novnc 6080 localhost:5900 &
exec gz sim -g -v2
