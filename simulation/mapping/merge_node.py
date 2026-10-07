"""Узел слияния: /robot_N/map всех роботов → /team/map в мировой системе координат (кадр "world").

Старты роботов задаёт default_bases (те же, что у спавна); параметр robot_ids — список идентификаторов.
Карта публикуется раз в секунду и по каждому обновлению, пока известна хотя бы одна карта.
"""
import os
import sys

import rclpy
from nav_msgs.msg import OccupancyGrid
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from merge import RobotMap, merge_maps  # noqa: E402
from robot_model import default_bases  # noqa: E402

TEAM_MAP_TOPIC = "/team/map"


class TeamMapMerger(Node):
    def __init__(self):
        super().__init__("team_map_merger")
        self.declare_parameter("robot_ids", ["robot_1", "robot_2"])
        robot_ids = list(self.get_parameter("robot_ids").value)
        self._starts = default_bases(len(robot_ids))
        self._robot_ids = robot_ids
        self._latest = {}
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        for robot_id in robot_ids:
            self.create_subscription(OccupancyGrid, f"/{robot_id}/map",
                                     lambda message, rid=robot_id: self._on_map(rid, message), latched)
        self._publisher = self.create_publisher(OccupancyGrid, TEAM_MAP_TOPIC, latched)
        self.create_timer(1.0, self._publish)

    def _on_map(self, robot_id, message):
        info = message.info
        self._latest[robot_id] = RobotMap(info.resolution, info.width, info.height, info.origin.position.x,
                                          info.origin.position.y, list(message.data), self._starts[robot_id])

    def _publish(self):
        if not self._latest:
            return
        merged = merge_maps([self._latest[robot_id] for robot_id in self._robot_ids if robot_id in self._latest])
        message = OccupancyGrid()
        message.header.frame_id = "world"
        message.header.stamp = self.get_clock().now().to_msg()
        message.info.resolution = merged.resolution_m
        message.info.width, message.info.height = merged.width, merged.height
        message.info.origin.position.x, message.info.origin.position.y = merged.origin_x_m, merged.origin_y_m
        message.info.origin.orientation.w = 1.0
        message.data = merged.data
        self._publisher.publish(message)


def main():
    rclpy.init()
    node = TeamMapMerger()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
