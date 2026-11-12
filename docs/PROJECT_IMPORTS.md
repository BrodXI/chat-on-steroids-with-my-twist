# GitHub repositories and ChatGPT Projects in CoS

Open the **Projects +** menu (or the Inbox project **+**) to find both imports.

## Add a GitHub repository

Choose **GitHub repository…** and enter a repository root URL such as
`https://github.com/owner/repo` or `git@github.com:owner/repo.git`.
CoS creates a **GitHub-only Project** with instructions directing the agent to the
connected GitHub tool for that exact repository. It does not automatically create
a new native ChatGPT Project.

- No Git installation, local folder picker, disk checkout, repository cloning or
  storage for repository files is required. Only the small CoS project catalog
  record (name, canonical GitHub URL and ID) is saved locally.
- Private repository access relies on the connected GitHub tool's permission,
  not local Git credentials. If the tool is not connected, the agent must ask for
  connection before claiming access.
- CoS does not accept embedded passwords, non-GitHub hosts, or arbitrary Git transports.
- Opening and moving chats into this Project does not set a local working folder.
  Local filesystem, project-file and terminal actions do not act on the GitHub repo.
- GitHub repositories are different from SSH server folders: a GitHub URL should use
  this action, not **Folder on a server (SSH)**.

## Sync ChatGPT web Projects

Choose **Sync ChatGPT web Projects…**, then search and check just the Projects you
want, or press **Sync all**. CoS uses the catalog its connected browser has already
seen in the **current ChatGPT workspace**. To discover newly added Projects, open
`chatgpt.com` in the connected browser first. Then choose an approved local parent
folder for the new Project workspaces.

- Each imported Project receives its own empty, local folder and is linked by its
  native ChatGPT Project ID, not its name.
- Repeating a sync skips existing links instead of duplicating them. Names of
  previously imported CoS projects update when their web names change.
- An existing manually linked CoS Project is left intact, as is a Project that was
  deliberately removed from CoS's sidebar.
- **This is a project-identity and name sync.** It does not download old chats,
  attachments, knowledge files or instructions from ChatGPT, and it does not copy
  local files back to the website. New CoS chats can use the linked ChatGPT Project.
- **Sync all** means all recently discovered Projects in the active ChatGPT workspace
  (up to the current catalog limit), not Projects in other accounts or workspaces.

**Only ChatGPT web Project sync** requires choosing a local folder. GitHub-only
Projects grant no local filesystem permissions or working directories.
