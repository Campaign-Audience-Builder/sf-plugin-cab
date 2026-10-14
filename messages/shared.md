# flags.verbose.summary

Show all lines of each list, record Ids, and stack traces.

# flags.target-org.summary

Username or alias of the org.

# error.orgNotFound

The sf CLI has no org with the alias or username "%s".

# error.orgNotFound.actions

- Log in to the org: sf org login web --alias %s
- Show the orgs that the sf CLI knows: sf org list

# error.noDefaultOrg

No org given, and the sf CLI has no default org.

# error.noDefaultOrg.actions

- Give the org with --target-org (-o).
- Set a default org: sf config set target-org <alias>
