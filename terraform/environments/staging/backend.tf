# Region confirmed: nyc3, matching the comprobify-terraform-state Spaces bucket.
#
# skip_requesting_account_id is required against DO Spaces (or any non-AWS
# S3-compatible store) — without it, Terraform's S3 backend tries to look up the AWS
# account ID via STS GetCallerIdentity / IAM ListRoles by default, both of which DO
# Spaces doesn't implement, causing init to fail with a 403 InvalidClientTokenId error
# even though the credentials themselves are correct.
#
# skip_s3_checksum avoids a similar incompatibility: newer AWS SDK versions send
# checksum headers on S3 writes that not all S3-compatible providers support.
terraform {
  backend "s3" {
    endpoints = {
      s3 = "https://nyc3.digitaloceanspaces.com"
    }
    region                      = "us-east-1" # required by the S3 backend syntax, ignored by Spaces
    bucket                      = "comprobify-terraform-state"
    key                         = "staging/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
