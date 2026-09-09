import { after, NextRequest, NextResponse } from "next/server";
import { requestUser } from "../../../lib/request-auth";
import {
  allTasks,
  itemDetail,
  listUsers,
  projectDb,
  snapshot,
} from "../../../lib/project-store";
import {
  addComment,
  convertItem,
  createItem,
  deleteItem,
  followItem,
  linkItem,
  unlinkItem,
  updateItem,
} from "../../../lib/project-commands";
import { commandBody, projectError } from "../../../lib/project-http";
import { ProjectError } from "../../../lib/project-errors";
import { notifyProjectInBackground } from "../../../lib/project-notifications";

export async function GET(req: NextRequest) {
  const db = projectDb();
  try {
    const user = requestUser(req, db);
    if (!user) throw new ProjectError("Unauthorized", 401);
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const detail = itemDetail(db, id);
      if (!detail) throw new ProjectError("Item not found.", 404);
      return NextResponse.json({ detail });
    }
    return NextResponse.json({
      user,
      users: listUsers(db),
      sections: snapshot(db),
      items: allTasks(db).map((t) => ({ ...t, children: [] })),
    });
  } catch (error) {
    return projectError(error);
  } finally {
    db.close();
  }
}
async function mutate(req: NextRequest, method: "POST" | "PATCH" | "DELETE") {
  const db = projectDb();
  try {
    const user = requestUser(req, db);
    if (!user) throw new ProjectError("Unauthorized", 401);
    let id: string | undefined;
    if (method === "DELETE") {
      deleteItem(db, user, req.nextUrl.searchParams.get("id") || "");
    } else {
      const { input, uploads } = await commandBody(req);
      if (method === "POST") {
        const action = input.action ?? "create";
        if (uploads.length && !["create", "comment"].includes(String(action)))
          throw new ProjectError(
            "Attachments belong to a description or comment.",
          );
        switch (action) {
          case "create":
            id = createItem(db, user, input, uploads).id;
            break;
          case "comment":
            id = addComment(db, user, input, uploads).taskId;
            break;
          case "convert":
            id = convertItem(db, user, input).id;
            break;
          case "follow":
            followItem(db, user, input);
            id = String(input.id);
            break;
          case "link":
            id = linkItem(db, user, input).sourceId;
            break;
          case "unlink":
            unlinkItem(db, user, input);
            id = String(input.id);
            break;
          default:
            throw new ProjectError("Unknown action.");
        }
      } else id = updateItem(db, user, input, uploads).id;
    }
    after(notifyProjectInBackground);
    return NextResponse.json(
      {
        id,
        sections: snapshot(db),
        ...(id ? { detail: itemDetail(db, id) } : {}),
      },
      { status: method === "POST" ? 201 : 200 },
    );
  } catch (error) {
    return projectError(error);
  } finally {
    db.close();
  }
}
export const POST = (req: NextRequest) => mutate(req, "POST");
export const PATCH = (req: NextRequest) => mutate(req, "PATCH");
export const DELETE = (req: NextRequest) => mutate(req, "DELETE");
