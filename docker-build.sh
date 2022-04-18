package_version=$(jq -r .version package.json)

docker build --platform linux/amd64 \
  -t dialectlab/tribeca-monitoring-service:"$package_version" \
  -t dialectlab/tribeca-monitoring-service:latest .