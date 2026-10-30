SELECT CURRENT_REGION() AS region,
       CURRENT_ACCOUNT() AS locator,
       CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME() AS account_identifier,
       CURRENT_USER() AS me;
