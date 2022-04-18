package_version=$(jq -r .version package.json)

docker push dialectlab/tribeca-monitoring-service:"$package_version"
docker push dialectlab/tribeca-monitoring-service:latest