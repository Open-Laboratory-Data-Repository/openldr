# Profile packs

A profile pack is a signed content pack that sets up one job on this install, such as a collection site. In one install it makes a role, a sidebar layout and forms. Administrators install and remove it in Marketplace.

## Install a profile pack

Do this when your organisation gives you a signed profile pack to set up a job, for example a collection site. You need **Manage marketplace** and **Manage roles**. A pack cannot give its role a capability you do not hold yourself.

1. Open **Settings**, then **Marketplace**.
2. Select **Browse**, then open the pack's card.
3. Open the dots menu at the top right and select **Install**.
4. Read the version and each line under **Steps**. The next task explains the lines.
5. Select the arrow at the right of each **Role** line and read its capabilities.
6. Select **Approve & install**.

**Expected result:** a message says **Installed** and the pack's id. The pack is listed under **Installed**. The new role is on the **Roles** page and the new layout is on the **Layouts** page, each marked **From pack** and the pack's id. The forms are published in Forms.

The new role has no members yet. Give it to people in Users. A person with the role sees the pack's layout as their sidebar by default, if the pack made it the default for that role.

OpenLDR checks every step before it writes anything. If a check fails, a message names the problem and nothing is installed. The Troubleshooting section lists the usual ones. If a step fails partway, the pack shows **Failed at step** with its number and the error. Fix the cause, then open the dots menu and select **Install again**.

## Read the summary lines

The install prompt lists one line per step, in the order the pack installs them. Each line gives the kind of step and its name. Most lines end with a count.

- **Needs** lists the plugins and packs that must be installed first, and how many. If one is missing or outside the version range, the install stops before it writes anything.
- **Role** gives the role's name and how many capabilities it grants. Select the arrow at the right of the line to list each capability by name.
- **Layout** gives the sidebar's name, its pages, and the roles it is the default for. An older server shows only how many pages it has.
- **Form** gives the form's title. It has no count.

Older steps, such as **Code system** or **Datasets**, show a plain number. Read the [Marketplace](/docs/marketplace) guide for those.

Read every capability of every role before you approve. Anyone you later give the role to gets all of them.

## Remove a profile pack

Do this when the install no longer needs the job the pack set up. You need **Manage marketplace**, and **Manage roles** when the pack made a role.

1. Open **Settings**, then **Marketplace**.
2. Select **Installed**, then open the pack.
3. Open the dots menu at the top right and select **Remove**.
4. Read the three lists: **Roles removed**, **Layouts removed** and **Forms kept**.
5. Select **Remove**.

**Expected result:** a message says **Removed** and the pack's id. The pack is no longer under **Installed**. Its roles and layouts are gone.

Removing keeps the pack's forms published, with every response. Archive a form in Forms if you no longer want it. A form that only the pack's roles could open loses that limit, so anyone who may view forms can then open it. Removing also leaves alone the code lists, queries, datasets and mappings the pack installed, and any plugin or pack it needed.

If someone still holds one of the pack's roles, the prompt says so in red and lists each role with its users. **Remove** stays off. Take the role from those users in Users, then open the prompt again.

## What "From pack" means

On the **Roles** page and the **Layouts** page, a role or layout that a pack made shows **From pack** and the pack's id under its name.

You can still edit that role or layout. The next update of the pack puts back what the pack says, and your edit is lost. If you delete it, the next install of the pack makes it again.

A pack never changes a role or layout it did not make. If you made a role or layout by hand with the same slug or name, the pack refuses to install.

An update of the pack removes a role or layout that the new version leaves out. It refuses while someone still holds that role, as removal does.

## Limits

- A pack's layout and forms can name only roles the same pack makes. A pack cannot attach them to a role you made.
- A layout only hides pages. The role's capabilities decide what a person can open.
- On a central server, a pack makes its role and layout on that server only. Roles and layouts do not travel to the labs. Its forms reach labs the way any form does.

## Troubleshooting

The messages below come from the server, in English. A word in angle brackets stands for a name.

- **The message says `installing this pack needs the roles.manage capability`.** You do not have **Manage roles**. Ask an administrator who has it to install the pack.
- **The message says `you cannot install a role that grants <capability>, because you do not hold it`.** Install the pack as someone who holds that capability.
- **The message says `a role with the slug <slug> already exists and this pack did not make it`.** Someone made that role by hand. The same applies to `a layout named <name>`. Delete yours if nobody needs it, or ask the publisher for a pack that uses another name.
- **The message says `this pack needs <id> <range>, which is not installed`.** Install that plugin or pack first, at a version in the range given.
- **The message says `this pack needs <id> <range>; <version> is installed`.** The installed version is outside the range. Install a version in the range given.
- **The prompt says `removing this pack needs the roles.manage capability`.** The pack made a role, so removing it needs **Manage roles**. Ask an administrator who has it to remove the pack.
- **Remove stays off.** Someone still holds one of the pack's roles. Take it from them in Users first.

## Related guides

- [Marketplace](/docs/marketplace)
- [Roles](/docs/roles)
- [Layouts](/docs/layouts)
- [Forms](/docs/forms)
