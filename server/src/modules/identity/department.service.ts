import { Injectable } from "@nestjs/common";
import { DepartmentRepository, type DepartmentRow } from "./department.repository.js";

/**
 * 部门用例（h1）：对外的 listDepartments 出口（技术设计v0.2 §1.2）。
 * 一期消费方：管理端组织维护（D1-06，u3 前端）与后续按部门的数据范围；本卡不新开 HTTP 端点。
 */
@Injectable()
export class DepartmentService {
  constructor(private readonly departments: DepartmentRepository) {}

  /** 部门列表：默认只返回在编（active），按名称升序；parentId 供消费方组树。 */
  async listDepartments(options: { includeDisabled?: boolean } = {}): Promise<DepartmentRow[]> {
    return this.departments.list(options);
  }

  async getBySourceId(sourceId: string): Promise<DepartmentRow | null> {
    return this.departments.findBySourceId(sourceId);
  }
}
