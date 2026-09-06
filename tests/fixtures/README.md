# Video fixture

`motion.webm` is an original synthetic one-second test clip generated from FFmpeg's `testsrc2` source. It contains no third-party footage. Regenerate with:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=64x64:rate=5:duration=1' \
  -c:v libvpx-vp9 -b:v 32k -an motion.webm
```

It is used to verify browser video decoding, seeking and GPU texture upload. FFmpeg is not needed to run Fluxweave or the test with the included fixture.
