# iPhone Sensors Playground

This folder processes the iPhone capture in `../data/iphone-data-1`.

Generated outputs go into `outputs/`:

- `depth_overlay.mp4`: LiDAR depth projected onto the video frame and rendered in display orientation.
- `fusion_panel.mp4`: video plus synchronized pose, depth, acceleration, and gyro traces.
- `depth_projection_samples.png`: representative RGB/depth/overlay samples.
- `sensor_fusion_dashboard.png`: static plots for trajectory, IMU, depth, and orientation.
- `world_point_cloud_map.png`: coarse world-frame LiDAR point map from depth plus camera poses.
- `world_point_cloud_sample.ply`: sampled fused point cloud for external 3D viewers.
- `fused_timeline.csv`: per-video-frame timestamp, depth, pose, and nearest IMU values.
- `index.html`: local report linking the generated videos and images.

Run:

```bash
uv run python process_capture.py
```

The script uses the encoded `1920x1440` camera orientation for projection because the depth map and intrinsics share that 4:3 camera frame. Rendered videos are rotated into the iPhone display orientation afterwards.
