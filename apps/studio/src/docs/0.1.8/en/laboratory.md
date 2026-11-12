# Laboratory

Laboratory stores the issuing laboratory name, address, contact details and logo used by report templates. It also sets the default facility register and the local time zone.

Use your real laboratory details and approved logo. The pictures show a fictional laboratory in a test installation. No practice data is required. You need View settings to open the page and Edit general settings to save it.

The issuing laboratory is the organisation producing reports. Facilities are the organisations sending work. Choosing a default register here does not create or import facilities.

## Save your laboratory details

Use this after installation or when the issuing laboratory details change.

### 1. Open Settings and Laboratory

Open your user menu at the bottom left, choose **Settings**, then select **Laboratory**.

![Open your user menu at the bottom left.](laboratory-guide-user-menu.png)

![Choose Settings.](laboratory-guide-settings-menu.png)

![Select Laboratory in Settings.](laboratory-guide-laboratory-page.png)

### 2. Enter the laboratory name

Enter your issuing laboratory name in **Laboratory name**. The example uses `Documentation laboratory`.

![Enter your issuing laboratory name.](laboratory-guide-name.png)

### 3. Enter the address

Enter the address for your letterhead in **Address**. It can contain more than one line.

![Enter the address your report templates should print.](laboratory-guide-address.png)

### 4. Enter the contact details

Enter your approved contact details in **Contact**. The picture uses an example.invalid email address.

![Enter the contact information for the issuing laboratory.](laboratory-guide-contact.png)

### 5. Choose the facility register

In **Facility register**, select an existing registered source. If the needed source is absent, register it through Facilities first. This choice supplies the default register for the Facility form.

![Choose an existing register. Register a source through Facilities if the needed one is absent.](laboratory-guide-register.png)

### 6. Set the time zone when applicable

For PostgreSQL or MySQL, enter a named time zone such as `Africa/Dar_es_Salaam`. Read the help below the field. SQL Server requires a Windows time-zone name in each report run instead, so leave this setting empty there.

![Enter your named time zone on PostgreSQL or MySQL. Read the SQL Server exception below.](laboratory-guide-timezone.png)

### 7. Save the details

Open the page dots at the top right and select **Save**.

![Open the Laboratory page dots menu.](laboratory-guide-page-actions.png)

![Choose Save to keep the laboratory settings.](laboratory-guide-save-identity.png)

**Expected result:** The saved details remain when you reopen Laboratory.

![The saved laboratory identity remains after reopening the page.](laboratory-guide-identity-result.png)

## Remove an old logo

Use this when the current logo should no longer appear in templates that use the laboratory logo.

### 1. Clear the draft logo

Select **Clear** beside Logo. This changes the draft only.

![Clear removes the current logo from the draft.](laboratory-guide-clear-logo.png)

### 2. Save the removal

Open the page dots and select **Save**.

![Choose Save to keep the laboratory settings.](laboratory-guide-save-clear-logo.png)

**Expected result:** The saved laboratory settings no longer contain a logo.

## Upload the laboratory logo

Use a PNG or JPEG file up to 256 KB. Transparent PNG is useful for a letterhead logo.

### 1. Choose the image

Select **Choose file…** beside Logo and select your approved local image.

![Choose file opens an image file selection.](laboratory-guide-choose-logo.png)

### 2. Check the preview

Confirm that the expected image appears beside Logo. The picture reuses the test installation's shipped mark.

![The chosen PNG appears in the preview before saving.](laboratory-guide-logo-preview.png)

### 3. Save the logo

Open the page dots and select **Save**.

![Choose Save to keep the laboratory settings.](laboratory-guide-save-logo.png)

**Expected result:** The logo remains after reopening Laboratory. A report template must use the laboratory tokens to display these values.

![The saved logo remains after reopening Laboratory.](laboratory-guide-logo-result.png)

## Change laboratory details on a phone

Use the same fields on a phone. The page scrolls vertically.

### 1. Edit the identity fields

Enter the laboratory name and other fields within the phone-width form.

![Laboratory fields fit the phone width.](laboratory-guide-phone-name.png)

### 2. Scroll to Logo

Scroll down to the logo preview and Choose file control. Save changes through the page dots.

![Scroll to Logo. The preview and controls remain available.](laboratory-guide-phone-logo.png)

## Use the details in report templates

Report templates can use `{{lab.name}}`, `{{lab.address}}`, `{{lab.contact}}` and `{{lab.logo}}`. The page prints these token names below its description. Use Report Designer to place them in a template. Saving Laboratory does not edit a template.

## Optional practice

In a test installation, save a fictional laboratory name and example.invalid contact address. Reuse an approved test PNG or JPEG for the upload exercise. Restore your intended settings afterward.

## Limits

The logo accepts PNG and JPEG, up to 256 KB. SVG, WebP and image web addresses are not accepted. The register picker lists existing sources; it cannot register one.

## Troubleshooting

**The register list is empty.** Open Facilities and register the source before returning here.

**The time zone is refused.** Use a named zone, not a fixed offset. Follow the SQL Server exception shown below the field.

**The logo is refused.** Check its format and size. Choose a PNG or JPEG no larger than 256 KB.

**A report does not show the saved details.** Check whether its template uses the laboratory tokens.

## Related guides

Read [Facilities](/docs/facilities) to register a source. Read [Setup checks](/docs/setup-checks) to review readiness. Read [Start here](/docs/start-here) for command-line setup.
