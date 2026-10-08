import xml.etree.ElementTree as ET
from pathlib import Path

from did_judge.contacts import CONTACT_SENSOR_LINKS

SIMULATION_DIR = Path(__file__).resolve().parents[2]


def test_every_robot_collision_link_has_a_contact_sensor():
    model = ET.parse(SIMULATION_DIR / "models/turtlebot3_burger_contact/model.sdf").getroot()
    model_links = {link.attrib["name"]: link for link in model.findall(".//link")}
    for link_name, sensor_name in CONTACT_SENSOR_LINKS:
        link = model_links[link_name]
        sensor = link.find(f"sensor[@name='{sensor_name}']")
        assert sensor is not None and sensor.attrib["type"] == "contact"
        assert sensor.find("contact/collision") is not None


def test_world_loads_the_contact_system():
    world = ET.parse(SIMULATION_DIR / "worlds/turtlebot3_world_contact.world").getroot()
    plugins = world.findall(".//world/plugin")
    assert any(plugin.attrib.get("filename") == "gz-sim-contact-system" for plugin in plugins)
