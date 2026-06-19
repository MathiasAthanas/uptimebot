import { Controller, Get, Param } from '@nestjs/common';
import { GroupsService } from './groups.service';

@Controller('api/groups')
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Get()
  getGroups() {
    return this.groupsService.getGroups();
  }

  @Get(':name')
  getGroup(@Param('name') name: string) {
    return this.groupsService.getGroup(decodeURIComponent(name));
  }
}
