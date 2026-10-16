# Buffer API notes

Official documentation checked on 2026-10-16. Recheck the live schema if Buffer rejects a query; do not guess fields or silently switch to the retired REST API.

- Endpoint: `https://api.buffer.com`, GraphQL over POST.
- Authentication: `Authorization: Bearer <personal API key>`, for the user's own Buffer account.
- Discovery: `account { organizations { id name } }`, then `channels(input: {organizationId: ...}) {id name service}`.
- Creation: `createPost(input: CreatePostInput!)`, with `schedulingType: automatic`.
- Draft: `mode: addToQueue`, `saveToDraft: true`.
- Queue: `mode: addToQueue`.
- Exact schedule: `mode: customScheduled`, `dueAt` converted to UTC ISO 8601.
- Results: inspect `PostActionSuccess.post.id` and `MutationError.message`, as well as top-level `errors` and HTTP status.
- Retrieval: `post(input: {id: ...})` returning `id`, `channelId`, `status`, `text`, `dueAt`, and `assets {mimeType source thumbnail}`. Do not assume `assets.type` exists.
- Media input: `assets` is a list of entries containing exactly one of `image`, `video`, or `document`, each with a public file `url`. Local paths are not upload URLs.

The bundled CLI does not edit or delete posts, upload files, verify social-network delivery, or provide OAuth for third-party customers. Local media upload and scheduling an existing draft use Buffer's web app. Limits and channel requirements depend on the current account and platform.

Official references:

- [Getting started](https://developers.buffer.com/guides/getting-started.html)
- [Authentication](https://developers.buffer.com/guides/authentication.html)
- [Create a draft](https://developers.buffer.com/examples/create-draft-post.html)
- [Create an image post](https://developers.buffer.com/examples/create-image-post.html)
- [Retrieve assets](https://developers.buffer.com/examples/get-posts-with-assets.html)
