import { Module, Global } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../database/entities/user.entity";
import { RbacService } from "./services/rbac.service";
import { RolesGuard } from "./guards/roles.guard";

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [RbacService, RolesGuard],
  exports: [RbacService, RolesGuard],
})
export class RbacModule {}
