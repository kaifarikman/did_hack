import json,time,rclpy,sys
from rclpy.node import Node
from rclpy.executors import SingleThreadedExecutor,MultiThreadedExecutor
from rosgraph_msgs.msg import Clock
from nav_msgs.msg import Odometry
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from rclpy.qos import qos_profile_sensor_data
rclpy.init();node=Node('did_observation_diagnostic');counts={};latest={};gaps={};clock=[None]
def receive(name,stamp):
 now=time.monotonic();counts[name]=counts.get(name,0)+1
 if name in latest:gaps[name]=max(gaps.get(name,0),now-latest[name]['received'])
 latest[name]={'stamp':stamp,'received':now,'clock_delta':None if clock[0] is None else clock[0]-stamp}
def on_clock(message):
 clock[0]=message.clock.sec+message.clock.nanosec*1e-9;receive('clock',clock[0])
def on_telemetry(message):
 try: receive('telemetry',json.loads(message.data)['simulation_time_s'])
 except (KeyError,ValueError):pass
node.create_subscription(Clock,'/clock',on_clock,10)
node.create_subscription(Odometry,'/odom',lambda message:receive('odom',message.header.stamp.sec+message.header.stamp.nanosec*1e-9),10)
node.create_subscription(LaserScan,'/scan',lambda message:receive('scan',message.header.stamp.sec+message.header.stamp.nanosec*1e-9),qos_profile_sensor_data)
node.create_subscription(String,'/did/telemetry',on_telemetry,10)
executor=MultiThreadedExecutor(num_threads=4) if len(sys.argv)>1 else SingleThreadedExecutor();executor.add_node(node);started=time.monotonic();cpu=time.process_time();until=started+10
while time.monotonic()<until:executor.spin_once(timeout_sec=.1)
print(json.dumps({'executor':type(executor).__name__,'cpu_s':time.process_time()-cpu,'wall_s':time.monotonic()-started,'counts':counts,'max_receive_gap_s':gaps,'clock_delta_s':{k:v['clock_delta'] for k,v in latest.items()}}))
executor.shutdown();node.destroy_node();rclpy.shutdown()
